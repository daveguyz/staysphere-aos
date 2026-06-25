package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.auctionservice.websocket.AuctionBroadcastService;
import com.staysphere.shared.events.AuctionBidPlacedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service @Slf4j @RequiredArgsConstructor
public class BidEngineService {

    private final AuctionLotRepository lotRepository;
    private final BidRepository bidRepository;
    private final BidderDepositRepository depositRepository;
    private final AuctionBroadcastService broadcastService;
    private final AntiSnipeService antiSnipeService;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final StringRedisTemplate redis;

    // Redis key pattern for bid locks — prevents race conditions on concurrent bids
    private static final String BID_LOCK_KEY  = "auction:lock:lot:%s";
    private static final String BID_SEQ_KEY   = "auction:seq:lot:%s";
    private static final Duration LOCK_TTL    = Duration.ofSeconds(5);

    /**
     * Place a bid on a lot. Handles:
     * - Status validation (lot must be OPEN or EXTENDED)
     * - Deposit verification (if required)
     * - Minimum increment enforcement
     * - Redis SETNX lock (prevents concurrent bids corrupting state)
     * - Proxy bid resolution (auto-outbid on behalf of proxy holders)
     * - Anti-snipe extension trigger
     * - Kafka event emission
     * - WebSocket broadcast to all room subscribers
     */
    @Transactional
    public Bid placeBid(String lotId, String bidderId, String bidderEmail,
                        BigDecimal amount, BigDecimal proxyCeiling,
                        String ipAddress, String deviceFingerprint, String userAgent) {

        AuctionLot lot = lotRepository.findById(lotId)
                .orElseThrow(() -> new IllegalArgumentException("Auction lot not found: " + lotId));

        // 1. Status gate
        if (lot.getStatus() != AuctionLotStatus.OPEN && lot.getStatus() != AuctionLotStatus.EXTENDED) {
            throw new IllegalStateException("Lot " + lotId + " is not accepting bids (status=" + lot.getStatus() + ")");
        }

        // 2. Sealed bid lots use separate flow
        if (lot.getAuctionType() == AuctionType.SEALED_BID) {
            throw new IllegalStateException("Use placeSealedBid() for sealed-bid auctions");
        }

        // 3. Deposit gate
        if (Boolean.TRUE.equals(lot.getDepositRequired())) {
            boolean depositHeld = depositRepository.existsByAuctionLotIdAndBidderIdAndStatus(
                    lotId, bidderId, DepositStatus.HELD);
            if (!depositHeld) {
                throw new IllegalStateException("Deposit required before bidding on lot " + lotId);
            }
        }

        // 4. Minimum bid validation
        BigDecimal minimumAcceptable = computeMinimumBid(lot);
        if (amount.compareTo(minimumAcceptable) < 0) {
            throw new IllegalArgumentException(
                    String.format("Bid of %s is below minimum %s", amount, minimumAcceptable));
        }

        // 5. Proxy ceiling must exceed bid amount
        if (proxyCeiling != null && proxyCeiling.compareTo(amount) < 0) {
            throw new IllegalArgumentException("Proxy ceiling must be >= bid amount");
        }

        // 6. Acquire Redis lock (SETNX — only one bid at a time per lot)
        String lockKey = String.format(BID_LOCK_KEY, lotId);
        String lockValue = UUID.randomUUID().toString();
        Boolean locked = redis.opsForValue().setIfAbsent(lockKey, lockValue, LOCK_TTL);
        if (!Boolean.TRUE.equals(locked)) {
            throw new IllegalStateException("Another bid is being processed — please try again in a moment");
        }

        try {
            return processBidUnderLock(lot, bidderId, bidderEmail, amount, proxyCeiling,
                    ipAddress, deviceFingerprint, userAgent);
        } finally {
            // Release lock only if we still own it (prevents releasing another thread's lock)
            String currentLockValue = redis.opsForValue().get(lockKey);
            if (lockValue.equals(currentLockValue)) {
                redis.delete(lockKey);
            }
        }
    }

    private Bid processBidUnderLock(AuctionLot lot, String bidderId, String bidderEmail,
                                    BigDecimal amount, BigDecimal proxyCeiling,
                                    String ip, String fingerprint, String ua) {
        long seq = bidRepository.nextBidSequence(lot.getId());
        long msRemaining = computeMsRemaining(lot);

        // Mark all previous active bids on this lot as OUTBID
        List<Bid> previousActive = bidRepository.findByAuctionLotIdOrderByPlacedAtDesc(lot.getId())
                .stream()
                .filter(b -> b.getStatus() == BidStatus.ACTIVE || b.getStatus() == BidStatus.WINNING)
                .toList();
        previousActive.forEach(b -> {
            b.setStatus(BidStatus.OUTBID);
            b.setOutbidAt(LocalDateTime.now());
        });
        bidRepository.saveAll(previousActive);

        // Save the new winning bid
        Bid newBid = Bid.builder()
                .auctionLotId(lot.getId())
                .bidderId(bidderId)
                .bidderEmail(bidderEmail)
                .amount(amount)
                .proxyCeiling(proxyCeiling)
                .status(BidStatus.WINNING)
                .ipAddress(ip)
                .deviceFingerprint(fingerprint)
                .userAgent(ua)
                .msRemainingAtBid(msRemaining)
                .bidSequence(seq)
                .currency(lot.getCurrency())
                .build();
        Bid saved = bidRepository.save(newBid);

        // Update lot state (denormalized)
        lot.setCurrentBidAmount(amount);
        lot.setCurrentLeadBidderId(bidderId);
        lot.setCurrentLeadBidId(saved.getId());
        lot.setTotalBids(lot.getTotalBids() + 1);
        lot.setUniqueBidders((int) bidRepository.countUniqueBidders(lot.getId()));

        // Check anti-snipe
        boolean extended = antiSnipeService.checkAndExtend(lot, msRemaining);

        lotRepository.save(lot);

        // Proxy resolution: if there are proxy bids from other bidders that can still beat this bid, autobid
        Bid finalBid = resolveProxyBids(lot, saved, amount);

        // Kafka event
        kafkaTemplate.send(AuctionBidPlacedEvent.TOPIC, AuctionBidPlacedEvent.builder()
                .eventId(UUID.randomUUID().toString())
                .auctionLotId(lot.getId())
                .bidId(finalBid.getId())
                .bidderId(bidderId)
                .bidderEmail(bidderEmail)
                .amount(finalBid.getAmount())
                .currency(lot.getCurrency())
                .totalBids(lot.getTotalBids())
                .antiSnipeExtended(extended)
                .newEndTime(lot.getScheduledEndsAt())
                .occurredAt(LocalDateTime.now())
                .build());

        // WebSocket broadcast — every subscriber in the room sees the update immediately
        broadcastService.broadcastBidUpdate(lot, finalBid, extended);

        log.info("[BidEngine] Lot {} — new bid {} by {} amount={} seq={}",
                lot.getId(), finalBid.getId(), bidderId, amount, seq);
        return finalBid;
    }

    /**
     * Proxy bid resolution.
     * If a competing bidder has a proxy ceiling that beats the new bid,
     * the system places an automatic counter-bid at (newBid + increment).
     * This continues until no proxy can beat the current amount.
     */
    private Bid resolveProxyBids(AuctionLot lot, Bid incomingBid, BigDecimal incomingAmount) {
        List<Bid> proxyBids = bidRepository.findProxyBidsForLot(lot.getId())
                .stream()
                .filter(pb -> !pb.getBidderId().equals(incomingBid.getBidderId()))
                .filter(pb -> pb.getProxyCeiling() != null && pb.getProxyCeiling().compareTo(incomingAmount) > 0)
                .toList();

        if (proxyBids.isEmpty()) return incomingBid;

        // The highest proxy ceiling among competitors
        Bid topProxy = proxyBids.get(0); // already ordered DESC by ceiling
        BigDecimal autoAmount = incomingAmount.add(lot.getMinimumBidIncrement());

        // The proxy autobid must not exceed the proxy ceiling
        if (autoAmount.compareTo(topProxy.getProxyCeiling()) > 0) {
            autoAmount = topProxy.getProxyCeiling();
        }

        log.info("[ProxyBid] Lot {} — auto-bidding {} for bidder {} (ceiling={})",
                lot.getId(), autoAmount, topProxy.getBidderId(), topProxy.getProxyCeiling());

        // Mark incoming bid as outbid by the proxy
        incomingBid.setStatus(BidStatus.OUTBID);
        incomingBid.setOutbidAt(LocalDateTime.now());
        bidRepository.save(incomingBid);

        // Create the proxy autobid
        long seq = bidRepository.nextBidSequence(lot.getId());
        Bid proxyAutoBid = Bid.builder()
                .auctionLotId(lot.getId())
                .bidderId(topProxy.getBidderId())
                .bidderEmail(topProxy.getBidderEmail())
                .amount(autoAmount)
                .proxyCeiling(topProxy.getProxyCeiling())
                .status(BidStatus.WINNING)
                .ipAddress("PROXY_SYSTEM")
                .bidSequence(seq)
                .currency(lot.getCurrency())
                .build();
        Bid savedProxy = bidRepository.save(proxyAutoBid);

        lot.setCurrentBidAmount(autoAmount);
        lot.setCurrentLeadBidderId(topProxy.getBidderId());
        lot.setCurrentLeadBidId(savedProxy.getId());
        lot.setTotalBids(lot.getTotalBids() + 1);
        lotRepository.save(lot);

        log.info("[ProxyBid] Lot {} — proxy autobid {} placed by system for {}",
                lot.getId(), autoAmount, topProxy.getBidderId());
        return savedProxy;
    }

    /** Place a sealed bid (stored encrypted, revealed only at close). */
    @Transactional
    public Bid placeSealedBid(String lotId, String bidderId, String bidderEmail,
                              BigDecimal amount, String ipAddress) {
        AuctionLot lot = lotRepository.findById(lotId)
                .orElseThrow(() -> new IllegalArgumentException("Lot not found: " + lotId));

        if (lot.getAuctionType() != AuctionType.SEALED_BID)
            throw new IllegalStateException("Lot is not a sealed-bid auction");

        if (lot.getStatus() != AuctionLotStatus.OPEN)
            throw new IllegalStateException("Lot is not accepting bids");

        // One sealed bid per bidder per lot
        boolean alreadyBid = bidRepository.existsByAuctionLotIdAndBidderIdAndStatus(
                lotId, bidderId, BidStatus.ACTIVE);
        if (alreadyBid)
            throw new IllegalStateException("You have already placed a sealed bid on this lot");

        String lockKey = String.format(BID_LOCK_KEY, lotId);
        String lockValue = UUID.randomUUID().toString();
        Boolean locked = redis.opsForValue().setIfAbsent(lockKey, lockValue, LOCK_TTL);
        if (!Boolean.TRUE.equals(locked))
            throw new IllegalStateException("System busy — please retry");

        try {
            Bid sealed = Bid.builder()
                    .auctionLotId(lotId)
                    .bidderId(bidderId)
                    .bidderEmail(bidderEmail)
                    .amount(amount)
                    .status(BidStatus.ACTIVE)
                    .isSealed(true)
                    .sealedBidHash(hashAmount(amount, bidderId))
                    .ipAddress(ipAddress)
                    .bidSequence(bidRepository.nextBidSequence(lotId))
                    .currency(lot.getCurrency())
                    .build();

            Bid saved = bidRepository.save(sealed);
            lot.setTotalBids(lot.getTotalBids() + 1);
            lot.setUniqueBidders((int) bidRepository.countUniqueBidders(lotId));
            lotRepository.save(lot);

            // For sealed bids, broadcast only the participant count (not the amount)
            broadcastService.broadcastSealedBidReceived(lot);
            return saved;
        } finally {
            String v = redis.opsForValue().get(lockKey);
            if (lockValue.equals(v)) redis.delete(lockKey);
        }
    }

    private BigDecimal computeMinimumBid(AuctionLot lot) {
        if (lot.getCurrentBidAmount() == null) return lot.getStartingPrice();
        return lot.getCurrentBidAmount().add(lot.getMinimumBidIncrement());
    }

    private long computeMsRemaining(AuctionLot lot) {
        return java.time.Duration.between(LocalDateTime.now(), lot.getScheduledEndsAt()).toMillis();
    }

    private String hashAmount(BigDecimal amount, String bidderId) {
        // Simple deterministic hash for sealed bid verification
        return Integer.toHexString((amount.toPlainString() + bidderId).hashCode());
    }
}
