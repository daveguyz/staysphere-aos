package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.auctionservice.websocket.AuctionBroadcastService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Service @Slf4j @RequiredArgsConstructor
public class DutchAuctionService {

    private final AuctionLotRepository lotRepository;
    private final BidRepository bidRepository;
    private final AuctionLotService lotService;
    private final AuctionBroadcastService broadcastService;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final StringRedisTemplate redis;

    private static final String DUTCH_LAST_DECREMENT_KEY = "auction:dutch:last_decrement:%s";

    /**
     * Called every 5 seconds by the scheduler.
     * For each OPEN Dutch auction lot, check if it's time to decrement price.
     */
    @Scheduled(fixedRate = 5000)
    public void processDutchPriceDecrements() {
        lotRepository.findAllLiveLots().stream()
                .filter(lot -> lot.getAuctionType() == AuctionType.DUTCH)
                .forEach(this::processDecrement);
    }

    @Transactional
    protected void processDecrement(AuctionLot lot) {
        if (lot.getDutchDecrementIntervalSeconds() == null
                || lot.getDutchDecrementAmount() == null
                || lot.getDutchFloorPrice() == null) return;

        String key = String.format(DUTCH_LAST_DECREMENT_KEY, lot.getId());
        String lastDecrementStr = redis.opsForValue().get(key);
        LocalDateTime lastDecrement = lastDecrementStr != null
                ? LocalDateTime.parse(lastDecrementStr) : lot.getActualEndsAt(); // fallback to open time

        long secondsSinceLast = java.time.Duration.between(
                lastDecrement != null ? lastDecrement : lot.getActualEndsAt(),
                LocalDateTime.now()).toSeconds();

        if (secondsSinceLast < lot.getDutchDecrementIntervalSeconds()) return;

        BigDecimal currentPrice = lot.getCurrentBidAmount() != null
                ? lot.getCurrentBidAmount() : lot.getDutchStartPrice();

        BigDecimal newPrice = currentPrice.subtract(lot.getDutchDecrementAmount());

        if (newPrice.compareTo(lot.getDutchFloorPrice()) <= 0) {
            // Floor reached — close the lot (no winner)
            newPrice = lot.getDutchFloorPrice();
            log.info("[Dutch] Lot {} reached floor price {}", lot.getId(), newPrice);
            try { lotService.closeLot(lot.getId()); } catch (Exception e) {
                log.error("[Dutch] Error closing lot {}: {}", lot.getId(), e.getMessage());
            }
            return;
        }

        lot.setCurrentBidAmount(newPrice);
        lotRepository.save(lot);
        redis.opsForValue().set(key, LocalDateTime.now().toString());

        broadcastService.broadcastPriceDecrement(lot, newPrice);
        log.debug("[Dutch] Lot {} price decremented to {}", lot.getId(), newPrice);
    }

    /**
     * A bidder accepts the current Dutch price — they win immediately.
     */
    @Transactional
    public Bid acceptDutchPrice(String lotId, String bidderId, String bidderEmail,
                                String ipAddress, String fingerprint) {
        AuctionLot lot = lotRepository.findById(lotId)
                .orElseThrow(() -> new IllegalArgumentException("Lot not found: " + lotId));

        if (lot.getAuctionType() != AuctionType.DUTCH)
            throw new IllegalStateException("Not a Dutch auction");
        if (lot.getStatus() != AuctionLotStatus.OPEN && lot.getStatus() != AuctionLotStatus.EXTENDED)
            throw new IllegalStateException("Lot is not accepting bids");

        BigDecimal acceptedPrice = lot.getCurrentBidAmount() != null
                ? lot.getCurrentBidAmount() : lot.getDutchStartPrice();

        // Create the winning bid immediately
        Bid winBid = Bid.builder()
                .auctionLotId(lotId)
                .bidderId(bidderId)
                .bidderEmail(bidderEmail)
                .amount(acceptedPrice)
                .status(BidStatus.WON)
                .ipAddress(ipAddress)
                .deviceFingerprint(fingerprint)
                .bidSequence(1L)
                .currency(lot.getCurrency())
                .build();
        Bid saved = bidRepository.save(winBid);

        // Close lot immediately
        lot.setStatus(AuctionLotStatus.CLOSED);
        lot.setActualEndsAt(LocalDateTime.now());
        lot.setWinnerId(bidderId);
        lot.setWinningBidId(saved.getId());
        lot.setWinningAmount(acceptedPrice);
        lot.setTotalBids(1);
        lot.setUniqueBidders(1);
        lotRepository.save(lot);

        broadcastService.broadcastDutchAccepted(lot, saved);
        log.info("[Dutch] Lot {} SOLD to {} at {}", lotId, bidderId, acceptedPrice);
        return saved;
    }
}
