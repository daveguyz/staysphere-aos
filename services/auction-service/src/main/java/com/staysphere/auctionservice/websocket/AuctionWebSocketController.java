package com.staysphere.auctionservice.websocket;

import com.staysphere.auctionservice.model.Bid;
import com.staysphere.auctionservice.service.*;
import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.*;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;

import java.math.BigDecimal;
import java.security.Principal;
import java.util.Map;

@Controller @Slf4j @RequiredArgsConstructor
public class AuctionWebSocketController {

    private final BidEngineService bidEngineService;
    private final DutchAuctionService dutchAuctionService;
    private final AuctionPresenceService presenceService;
    private final AuctionLotService lotService;

    /**
     * Client sends: SEND /ws/auction/{lotId}/bid
     * Body: { "amount": 5000, "proxyCeiling": 7500 }
     * Broadcast reply goes to: /topic/auction/{lotId}
     */
    @MessageMapping("/auction/{lotId}/bid")
    public void placeBid(@DestinationVariable String lotId,
                         @Payload PlaceBidMessage msg,
                         SimpMessageHeaderAccessor headerAccessor,
                         Principal principal) {
        if (principal == null) {
            log.warn("[WS] Unauthenticated bid attempt on lot {}", lotId);
            return;
        }

        String bidderId = principal.getName();
        String sessionId = headerAccessor.getSessionId();
        String ip = (String) headerAccessor.getSessionAttributes().getOrDefault("ip", "UNKNOWN");

        try {
            bidEngineService.placeBid(
                    lotId, bidderId, msg.getBidderEmail(),
                    msg.getAmount(), msg.getProxyCeiling(),
                    ip, msg.getDeviceFingerprint(), headerAccessor.getFirstNativeHeader("User-Agent")
            );
        } catch (Exception e) {
            log.warn("[WS] Bid rejected on lot {} by {}: {}", lotId, bidderId, e.getMessage());
            // Send error only to the bidder's session
        }
    }

    /**
     * Dutch auction accept: SEND /ws/auction/{lotId}/dutch-accept
     */
    @MessageMapping("/auction/{lotId}/dutch-accept")
    public void acceptDutchPrice(@DestinationVariable String lotId,
                                  SimpMessageHeaderAccessor headerAccessor,
                                  Principal principal) {
        if (principal == null) return;
        String bidderId = principal.getName();
        String ip = (String) headerAccessor.getSessionAttributes().getOrDefault("ip", "UNKNOWN");
        dutchAuctionService.acceptDutchPrice(lotId, bidderId, "", ip, null);
    }

    /**
     * Client subscribes to /app/auction/{lotId}/join — gets current state snapshot.
     */
    @SubscribeMapping("/auction/{lotId}/join")
    public Map<String, Object> joinRoom(@DestinationVariable String lotId,
                                         SimpMessageHeaderAccessor headerAccessor,
                                         Principal principal) {
        String sessionId = headerAccessor.getSessionId();
        String userId = principal != null ? principal.getName() : null;
        String ip = (String) headerAccessor.getSessionAttributes().getOrDefault("ip", "UNKNOWN");

        presenceService.userJoined(lotId, sessionId, userId, null, ip);

        var lot = lotService.getLot(lotId);
        long viewers = presenceService.getViewerCount(lotId);

        return Map.of(
                "type",          "ROOM_STATE",
                "lotId",         lotId,
                "status",        lot.getStatus().name(),
                "auctionType",   lot.getAuctionType().name(),
                "currentBid",    lot.getCurrentBidAmount() != null ? lot.getCurrentBidAmount() : lot.getStartingPrice(),
                "currency",      lot.getCurrency(),
                "totalBids",     lot.getTotalBids(),
                "uniqueBidders", lot.getUniqueBidders(),
                "endsAt",        lot.getScheduledEndsAt().toString(),
                "viewers",       viewers
        );
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class PlaceBidMessage {
        private BigDecimal amount;
        private BigDecimal proxyCeiling;
        private String bidderEmail;
        private String deviceFingerprint;
    }
}
