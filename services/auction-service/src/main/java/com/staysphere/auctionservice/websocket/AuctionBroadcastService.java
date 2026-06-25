package com.staysphere.auctionservice.websocket;

import com.staysphere.auctionservice.model.AuctionLot;
import com.staysphere.auctionservice.model.Bid;
import com.staysphere.auctionservice.service.AuctionPresenceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

@Service @Slf4j @RequiredArgsConstructor
public class AuctionBroadcastService {

    private final SimpMessagingTemplate messaging;
    private final AuctionPresenceService presenceService;

    /** Broadcast a new bid to all subscribers in the auction room. */
    public void broadcastBidUpdate(AuctionLot lot, Bid bid, boolean antiSnipeExtended) {
        long viewers = presenceService.getViewerCount(lot.getId());
        Map<String, Object> payload = Map.of(
                "type",              "BID_UPDATE",
                "lotId",             lot.getId(),
                "bidId",             bid.getId(),
                "amount",            bid.getAmount(),
                "currency",          bid.getCurrency(),
                "totalBids",         lot.getTotalBids(),
                "uniqueBidders",     lot.getUniqueBidders(),
                "activeViewers",     viewers,
                "antiSnipeExtended", antiSnipeExtended,
                "newEndTime",        lot.getScheduledEndsAt().toString(),
                "timestamp",         LocalDateTime.now().toString()
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
        log.debug("[WS] BID_UPDATE broadcast to lot {}: amount={}", lot.getId(), bid.getAmount());
    }

    /** Broadcast Dutch price decrement. */
    public void broadcastPriceDecrement(AuctionLot lot, BigDecimal newPrice) {
        Map<String, Object> payload = Map.of(
                "type",      "DUTCH_PRICE_UPDATE",
                "lotId",     lot.getId(),
                "newPrice",  newPrice,
                "currency",  lot.getCurrency(),
                "endsAt",    lot.getScheduledEndsAt().toString(),
                "timestamp", LocalDateTime.now().toString()
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
    }

    /** Broadcast Dutch auction accepted — lot sold instantly. */
    public void broadcastDutchAccepted(AuctionLot lot, Bid bid) {
        Map<String, Object> payload = Map.of(
                "type",      "DUTCH_ACCEPTED",
                "lotId",     lot.getId(),
                "amount",    bid.getAmount(),
                "currency",  lot.getCurrency(),
                "timestamp", LocalDateTime.now().toString()
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
    }

    /** Broadcast sealed bid received (count only, never amount). */
    public void broadcastSealedBidReceived(AuctionLot lot) {
        Map<String, Object> payload = Map.of(
                "type",      "SEALED_BID_RECEIVED",
                "lotId",     lot.getId(),
                "totalBids", lot.getTotalBids(),
                "timestamp", LocalDateTime.now().toString()
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
    }

    /** Broadcast lot opened — all viewers get notified. */
    public void broadcastLotOpened(AuctionLot lot) {
        Map<String, Object> payload = Map.of(
                "type",          "LOT_OPENED",
                "lotId",         lot.getId(),
                "auctionType",   lot.getAuctionType().name(),
                "startingPrice", lot.getStartingPrice(),
                "currency",      lot.getCurrency(),
                "endsAt",        lot.getScheduledEndsAt().toString(),
                "timestamp",     LocalDateTime.now().toString()
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
    }

    /** Broadcast lot closed with winner info. */
    public void broadcastLotClosed(AuctionLot lot) {
        Map<String, Object> payload = Map.ofEntries(
                Map.entry("type",          "LOT_CLOSED"),
                Map.entry("lotId",         lot.getId()),
                Map.entry("status",        lot.getStatus().name()),
                Map.entry("winnerId",      lot.getWinnerId() != null ? lot.getWinnerId() : ""),
                Map.entry("winningAmount", lot.getWinningAmount() != null ? lot.getWinningAmount() : BigDecimal.ZERO),
                Map.entry("currency",      lot.getCurrency()),
                Map.entry("timestamp",     LocalDateTime.now().toString())
        );
        messaging.convertAndSend("/topic/auction/" + lot.getId(), payload);
    }

    /** Broadcast viewer count update. */
    public void broadcastPresenceUpdate(String lotId, long viewerCount) {
        messaging.convertAndSend("/topic/auction/" + lotId,
                Map.of("type", "PRESENCE_UPDATE", "lotId", lotId, "viewers", viewerCount));
    }
}
