package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.shared.events.AuctionLotClosedEvent;
import com.staysphere.shared.events.AuctionLotOpenedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service @Slf4j @RequiredArgsConstructor
public class AuctionLotService {

    private final AuctionLotRepository lotRepository;
    private final BidRepository bidRepository;
    private final BidderDepositRepository depositRepository;
    private final KafkaTemplate<String, Object> kafkaTemplate;

    @Transactional
    public AuctionLot createLot(AuctionLot lot) {
        lot.setStatus(AuctionLotStatus.DRAFT);
        lot.setTotalBids(0);
        lot.setUniqueBidders(0);
        lot.setAntiSnipeExtensionCount(0);
        AuctionLot saved = lotRepository.save(lot);
        log.info("[AuctionLot] Created lot {} type={}", saved.getId(), saved.getAuctionType());
        return saved;
    }

    @Transactional
    public AuctionLot publishLot(String lotId, String requesterId) {
        AuctionLot lot = findLotOrThrow(lotId);
        assertOwner(lot, requesterId);
        if (lot.getStatus() != AuctionLotStatus.DRAFT)
            throw new IllegalStateException("Only DRAFT lots can be published");
        lot.setStatus(AuctionLotStatus.SCHEDULED);
        return lotRepository.save(lot);
    }

    /**
     * Called by AuctionSchedulerService when startsAt is reached.
     * For Dutch auctions: also initialises the price at dutchStartPrice.
     */
    @Transactional
    public AuctionLot openLot(String lotId) {
        AuctionLot lot = findLotOrThrow(lotId);
        if (lot.getStatus() != AuctionLotStatus.SCHEDULED)
            throw new IllegalStateException("Lot " + lotId + " is not SCHEDULED (status=" + lot.getStatus() + ")");

        lot.setStatus(AuctionLotStatus.OPEN);
        if (lot.getAuctionType() == AuctionType.DUTCH && lot.getDutchStartPrice() != null) {
            lot.setCurrentBidAmount(lot.getDutchStartPrice());
        }

        AuctionLot saved = lotRepository.save(lot);
        kafkaTemplate.send(AuctionLotOpenedEvent.TOPIC, AuctionLotOpenedEvent.builder()
                .eventId(UUID.randomUUID().toString())
                .auctionLotId(lotId)
                .auctionType(lot.getAuctionType().name())
                .propertyId(lot.getPropertyId())
                .sellerId(lot.getSellerId())
                .startingPrice(lot.getStartingPrice())
                .scheduledEndsAt(lot.getScheduledEndsAt())
                .occurredAt(LocalDateTime.now())
                .build());

        log.info("[AuctionLot] Lot {} OPENED (type={})", lotId, lot.getAuctionType());
        return saved;
    }

    /**
     * Called by AuctionSchedulerService when scheduledEndsAt is reached.
     * Determines winner and transitions to CLOSED or NO_RESERVE.
     */
    @Transactional
    public AuctionLot closeLot(String lotId) {
        AuctionLot lot = findLotOrThrow(lotId);
        if (lot.getStatus() != AuctionLotStatus.OPEN && lot.getStatus() != AuctionLotStatus.EXTENDED)
            throw new IllegalStateException("Lot is not OPEN/EXTENDED");

        lot.setActualEndsAt(LocalDateTime.now());

        Optional<Bid> winnerOpt;
        if (lot.getAuctionType() == AuctionType.SEALED_BID) {
            winnerOpt = bidRepository.findAllBidsForLotOrdered(lotId)
                    .stream().findFirst();
        } else if (lot.getAuctionType() == AuctionType.REVERSE) {
            // Lowest unique bid wins
            winnerOpt = findLowestUniqueBid(lotId);
        } else {
            winnerOpt = bidRepository.findWinningBid(lotId);
        }

        if (winnerOpt.isPresent()) {
            Bid winner = winnerOpt.get();
            // Check reserve price
            if (lot.getReservePrice() != null
                    && winner.getAmount().compareTo(lot.getReservePrice()) < 0) {
                lot.setStatus(AuctionLotStatus.NO_RESERVE);
                log.info("[AuctionLot] Lot {} closed — reserve not met ({} < {})",
                        lotId, winner.getAmount(), lot.getReservePrice());
            } else {
                lot.setStatus(AuctionLotStatus.CLOSED);
                lot.setWinnerId(winner.getBidderId());
                lot.setWinningBidId(winner.getId());
                lot.setWinningAmount(winner.getAmount());
                winner.setStatus(BidStatus.WON);
                bidRepository.save(winner);

                // Mark all other bids as LOST
                bidRepository.findByAuctionLotIdOrderByPlacedAtDesc(lotId)
                        .stream()
                        .filter(b -> !b.getId().equals(winner.getId()))
                        .forEach(b -> { b.setStatus(BidStatus.LOST); bidRepository.save(b); });

                log.info("[AuctionLot] Lot {} CLOSED — winner={} amount={}",
                        lotId, winner.getBidderId(), winner.getAmount());
            }
        } else {
            lot.setStatus(AuctionLotStatus.NO_RESERVE);
            log.info("[AuctionLot] Lot {} closed with no bids", lotId);
        }

        AuctionLot saved = lotRepository.save(lot);

        kafkaTemplate.send(AuctionLotClosedEvent.TOPIC, AuctionLotClosedEvent.builder()
                .eventId(UUID.randomUUID().toString())
                .auctionLotId(lotId)
                .propertyId(lot.getPropertyId())
                .sellerId(lot.getSellerId())
                .winnerId(lot.getWinnerId())
                .winningAmount(lot.getWinningAmount())
                .currency(lot.getCurrency())
                .hadWinner(lot.getWinnerId() != null)
                .reserveMet(lot.getStatus() == AuctionLotStatus.CLOSED)
                .occurredAt(LocalDateTime.now())
                .build());

        return saved;
    }

    public AuctionLot getLot(String lotId) { return findLotOrThrow(lotId); }

    public Page<AuctionLot> getLotsByStatus(AuctionLotStatus status, Pageable pageable) {
        return lotRepository.findByStatusOrderByStartsAtAsc(status, pageable);
    }

    public Page<AuctionLot> getLotsByStatuses(List<AuctionLotStatus> statuses, Pageable pageable) {
        return lotRepository.findByStatusInOrderByStartsAtAsc(statuses, pageable);
    }

    public Page<AuctionLot> getSellerLots(String sellerId, Pageable pageable) {
        return lotRepository.findBySellerIdOrderByCreatedAtDesc(sellerId, pageable);
    }

    @Transactional
    public AuctionLot updateLot(String lotId, AuctionLot updates, String requesterId) {
        AuctionLot lot = findLotOrThrow(lotId);
        assertOwner(lot, requesterId);
        if (lot.getStatus() == AuctionLotStatus.OPEN || lot.getStatus() == AuctionLotStatus.EXTENDED
                || lot.getStatus() == AuctionLotStatus.CLOSED)
            throw new IllegalStateException("Cannot edit a lot that is OPEN, EXTENDED, or CLOSED");

        // Patch allowed fields
        if (updates.getTitle() != null) lot.setTitle(updates.getTitle());
        if (updates.getDescription() != null) lot.setDescription(updates.getDescription());
        if (updates.getStartsAt() != null) lot.setStartsAt(updates.getStartsAt());
        if (updates.getScheduledEndsAt() != null) lot.setScheduledEndsAt(updates.getScheduledEndsAt());
        if (updates.getStartingPrice() != null) lot.setStartingPrice(updates.getStartingPrice());
        if (updates.getReservePrice() != null) lot.setReservePrice(updates.getReservePrice());
        if (updates.getBuyItNowPrice() != null) lot.setBuyItNowPrice(updates.getBuyItNowPrice());
        if (updates.getAntiSnipeEnabled() != null) lot.setAntiSnipeEnabled(updates.getAntiSnipeEnabled());
        if (updates.getAntiSnipeTriggerSeconds() != null) lot.setAntiSnipeTriggerSeconds(updates.getAntiSnipeTriggerSeconds());
        if (updates.getAntiSnipeExtensionSeconds() != null) lot.setAntiSnipeExtensionSeconds(updates.getAntiSnipeExtensionSeconds());
        if (updates.getDepositRequired() != null) lot.setDepositRequired(updates.getDepositRequired());
        if (updates.getDepositAmount() != null) lot.setDepositAmount(updates.getDepositAmount());
        if (updates.getImageUrls() != null) lot.setImageUrls(updates.getImageUrls());

        return lotRepository.save(lot);
    }

    @Transactional
    public void cancelLot(String lotId, String requesterId) {
        AuctionLot lot = findLotOrThrow(lotId);
        assertOwner(lot, requesterId);
        if (lot.getStatus() == AuctionLotStatus.SETTLED)
            throw new IllegalStateException("Cannot cancel a settled lot");
        lot.setStatus(AuctionLotStatus.CANCELLED);
        lotRepository.save(lot);

        // Release all deposits
        depositRepository.findByAuctionLotIdAndStatus(lotId, DepositStatus.HELD)
                .forEach(dep -> {
                    dep.setStatus(DepositStatus.RELEASED);
                    dep.setReleaseReason("LOT_CANCELLED");
                    dep.setReleasedAt(LocalDateTime.now());
                    depositRepository.save(dep);
                });
    }

    // ─── Reverse auction helpers ──────────────────────────────────────────
    private Optional<Bid> findLowestUniqueBid(String lotId) {
        List<Bid> allBids = bidRepository.findAllBidsForLotOrdered(lotId);
        return allBids.stream()
                .filter(b -> allBids.stream()
                        .filter(other -> other.getAmount().compareTo(b.getAmount()) == 0)
                        .count() == 1)
                .min((a, b2) -> a.getAmount().compareTo(b2.getAmount()));
    }

    private AuctionLot findLotOrThrow(String id) {
        return lotRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Auction lot not found: " + id));
    }

    private void assertOwner(AuctionLot lot, String userId) {
        if (!lot.getSellerId().equals(userId))
            throw new SecurityException("Not authorised to modify lot " + lot.getId());
    }
}
