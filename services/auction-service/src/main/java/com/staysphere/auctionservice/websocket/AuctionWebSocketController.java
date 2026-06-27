package com.staysphere.auctionservice.websocket;

import com.staysphere.auctionservice.model.Bid;
import com.staysphere.auctionservice.model.LotQuestion;
import com.staysphere.auctionservice.service.*;
import com.staysphere.auctionservice.websocket.AuctionBroadcastService;
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
    private final LotQuestionService questionService;
    private final AuctionBroadcastService broadcastService;

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
                    ip, msg.getDeviceFingerprint(),
                    headerAccessor.getFirstNativeHeader("User-Agent"),
                    msg.getCredentialToken()  // Phase 5 credential gate
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


    /**
     * Bidder sends a question: SEND /ws/auction/{lotId}/question
     * Body: { "content": "...", "category": "GENERAL" }
     *
     * On receipt:
     *   1. Persists the question
     *   2. Pushes private receipt confirmation to /user/queue/auction-{lotId}-qa
     *   3. Pushes notification to /user/queue/auctioneer-{lotId}-queue
     */
    @MessageMapping("/auction/{lotId}/question")
    public void submitQuestion(@DestinationVariable String lotId,
                               @Payload SubmitQuestionMessage msg,
                               Principal principal,
                               SimpMessageHeaderAccessor headerAccessor) {
        if (principal == null) return;
        String bidderId = principal.getName();
        String email    = headerAccessor.getFirstNativeHeader("X-User-Email");
        if (email == null) email = "";

        try {
            LotQuestion question = questionService.submitQuestion(
                    lotId, bidderId, email, msg.getContent(), msg.getCategory());

            // 1. Private receipt to bidder
            broadcastService.sendToUser(bidderId,
                    "/queue/auction-" + lotId + "-qa",
                    java.util.Map.of(
                            "type",       "QA_RECEIVED",
                            "questionId", question.getId(),
                            "message",    "Question submitted — you'll be notified when answered"
                    ));

            // 2. Push to auctioneer queue (they may be on /pages/auctioneer-dashboard)
            String auctioneerId = lotService.getLot(lotId).getAuctioneerId();
            if (auctioneerId != null) {
                broadcastService.sendToUser(auctioneerId,
                        "/queue/auctioneer-" + lotId + "-queue",
                        java.util.Map.of(
                                "type",             "QA_RECEIVED",
                                "questionId",       question.getId(),
                                "bidderDisplayName", question.getBidderDisplayName(),
                                "category",         question.getCategory().name(),
                                "contentPreview",   question.getContent().substring(0, Math.min(80, question.getContent().length())),
                                "submittedAt",      question.getSubmittedAt().toString()
                        ));
            }
            log.info("[WS-QA] Lot {} — question {} submitted by {}", lotId, question.getId(), bidderId);

        } catch (Exception e) {
            log.warn("[WS-QA] Question rejected on lot {} by {}: {}", lotId, bidderId, e.getMessage());
        }
    }

    /**
     * Auctioneer answers: SEND /ws/auction/{lotId}/answer
     * Body: { "questionId": "...", "response": "...", "answerPublicly": true/false }
     *
     * If answerPublicly = false: sends to /user/queue/qa-answer-{bidderId}
     * If answerPublicly = true:  broadcasts to /topic/auction/{lotId} with type QA_PUBLIC_ANSWER
     */
    @MessageMapping("/auction/{lotId}/answer")
    public void answerQuestion(@DestinationVariable String lotId,
                               @Payload AnswerQuestionMessage msg,
                               Principal principal) {
        if (principal == null) return;
        String callerId = principal.getName();

        try {
            LotQuestion answered = questionService.answerQuestion(
                    msg.getQuestionId(), callerId, msg.getResponse(), msg.isAnswerPublicly());

            if (msg.isAnswerPublicly()) {
                // Broadcast to all room subscribers
                broadcastService.broadcastPublicAnswer(lotId, answered);
            } else {
                // Private answer — only the asking bidder sees it
                broadcastService.sendToUser(answered.getBidderId(),
                        "/queue/qa-answer-" + answered.getBidderId(),
                        java.util.Map.of(
                                "type",        "QA_ANSWER",
                                "questionId",  answered.getId(),
                                "response",    answered.getResponse(),
                                "respondedAt", answered.getRespondedAt().toString()
                        ));
            }
            log.info("[WS-QA] Lot {} — question {} answered by {} (public={})",
                    lotId, msg.getQuestionId(), callerId, msg.isAnswerPublicly());

        } catch (Exception e) {
            log.warn("[WS-QA] Answer rejected on lot {} by {}: {}", lotId, callerId, e.getMessage());
        }
    }

    @lombok.Data @NoArgsConstructor @AllArgsConstructor
    public static class SubmitQuestionMessage {
        private String content;
        private String category;
    }

    @lombok.Data @NoArgsConstructor @AllArgsConstructor
    public static class AnswerQuestionMessage {
        private String  questionId;
        private String  response;
        private boolean answerPublicly;
    }

    @Data @NoArgsConstructor @AllArgsConstructor
    public static class PlaceBidMessage {
        private BigDecimal amount;
        private BigDecimal proxyCeiling;
        private String bidderEmail;
        private String deviceFingerprint;
        /** Plaintext credential token from sessionStorage — validated server-side */
        private String credentialToken;
    }
}
