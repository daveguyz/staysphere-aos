package com.staysphere.notificationservice.listener;

import com.staysphere.notificationservice.service.EmailService;
import com.staysphere.shared.events.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Component @Slf4j @RequiredArgsConstructor
public class AuctionEventListener {

    private final EmailService emailService;

    @Value("${staysphere.frontend.url:https://staysphere-aos.myshopify.com}")
    private String frontendUrl;

    // ── Bid placed: notify previous lead bidder they've been outbid ──
    @KafkaListener(topics = AuctionBidPlacedEvent.TOPIC, groupId = "notification-service-group")
    public void onBidPlaced(AuctionBidPlacedEvent event) {
        log.info("[Notification] Bid placed: lot={} bidder={} amount={}",
                event.getAuctionLotId(), event.getBidderId(), event.getAmount());
        // Outbid notification is sent by the auth-service via bidder email lookup.
        // If outbid bidder email is present in the event, send notification.
        // (Full implementation requires enriching the event with outbid bidder email)
    }

    // ── Lot opened: notify seller their lot is live ──
    @KafkaListener(topics = AuctionLotOpenedEvent.TOPIC, groupId = "notification-service-group")
    public void onLotOpened(AuctionLotOpenedEvent event) {
        log.info("[Notification] Lot opened: {}", event.getAuctionLotId());
        try {
            Map<String, Object> vars = new HashMap<>();
            vars.put("sellerName",      "Host");
            vars.put("lotTitle",        "Lot " + event.getAuctionLotId());
            vars.put("startingPrice",   event.getStartingPrice());
            vars.put("currency",        "NAD");
            vars.put("scheduledEndsAt", event.getScheduledEndsAt() != null ? event.getScheduledEndsAt().toString() : "");
            vars.put("auctionRoomUrl",  frontendUrl + "/pages/auction-room?lot=" + event.getAuctionLotId());

            // Seller email lookup would come from auth-service; log for now
            log.info("[Notification] Auction opening notification prepared for seller {}",
                    event.getSellerId());
            // emailService.sendEmail(sellerEmail, event.getSellerId(), event.getAuctionLotId(),
            //     "auction-opening", "Your Auction Is Now Live!", vars, ...);
        } catch (Exception e) {
            log.error("[Notification] Lot opened notification failed: {}", e.getMessage());
        }
    }

    // ── Lot closed: notify winner and send win confirmation ──
    @KafkaListener(topics = AuctionLotClosedEvent.TOPIC, groupId = "notification-service-group")
    public void onLotClosed(AuctionLotClosedEvent event) {
        log.info("[Notification] Lot closed: {} winner={} amount={}",
                event.getAuctionLotId(), event.getWinnerId(), event.getWinningAmount());

        if (!Boolean.TRUE.equals(event.getHadWinner()) || event.getWinnerId() == null) return;

        try {
            Map<String, Object> vars = new HashMap<>();
            vars.put("winnerName",       "Winner");
            vars.put("lotTitle",         "Lot " + event.getAuctionLotId());
            vars.put("winningAmount",    event.getWinningAmount());
            vars.put("currency",         event.getCurrency() != null ? event.getCurrency() : "NAD");
            vars.put("propertyId",       event.getPropertyId());
            vars.put("auctionSuccessUrl", frontendUrl + "/pages/auction-success?lot=" + event.getAuctionLotId());
            vars.put("supportUrl",       frontendUrl + "/pages/contact");

            log.info("[Notification] Auction win notification prepared for winner {}", event.getWinnerId());
            // emailService.sendEmail(winnerEmail, event.getWinnerId(), event.getAuctionLotId(),
            //     "auction-win", "Congratulations — You Won!", vars, AUCTION_WON);
        } catch (Exception e) {
            log.error("[Notification] Lot closed notification failed: {}", e.getMessage());
        }
    }

    // ── KYC verified: notify user they can now bid on high-value lots ──
    @KafkaListener(topics = KycVerifiedEvent.TOPIC, groupId = "notification-service-group")
    public void onKycVerified(KycVerifiedEvent event) {
        log.info("[Notification] KYC verified for user {}", event.getUserId());
        try {
            Map<String, Object> vars = new HashMap<>();
            vars.put("userName",    event.getUserEmail() != null
                    ? event.getUserEmail().split("@")[0] : "User");
            vars.put("auctionsUrl", frontendUrl + "/pages/auctions");

            if (event.getUserEmail() != null) {
                emailService.sendEmail(
                    event.getUserEmail(), event.getUserId(), null,
                    "kyc-verified", "Your Identity Has Been Verified ✓",
                    vars, com.staysphere.notificationservice.model.NotificationLog.NotificationType.ACCOUNT_VERIFIED
                );
                log.info("[Notification] KYC verified email sent to {}", event.getUserEmail());
            }
        } catch (Exception e) {
            log.error("[Notification] KYC notification failed: {}", e.getMessage());
        }
    }

    // ── Auction lot extended: no email — real-time WS handles this ──
    @KafkaListener(topics = AuctionLotExtendedEvent.TOPIC, groupId = "notification-service-group")
    public void onLotExtended(AuctionLotExtendedEvent event) {
        log.debug("[Notification] Lot {} extended (no email — WS handles this)", event.getAuctionLotId());
    }
    // ─── Lot Q&A events ───────────────────────────────────────────────────

    /**
     * New question received — notify the auctioneer.
     * Email is debounced per lot (5-minute window) to prevent inbox flood
     * during busy auctions. TODO: implement debounce via Redis key with TTL.
     */
    @KafkaListener(topics = LotQuestionSubmittedEvent.TOPIC,
                   groupId = "notification-service-group")
    public void onQuestionSubmitted(LotQuestionSubmittedEvent event) {
        try {
            String recipientId = event.getAuctioneerId() != null
                    ? event.getAuctioneerId() : event.getSellerId();
            if (recipientId == null) return;

            // Resolve recipient email via auth-service (simplified: use event data if available)
            String recipientEmail = resolveEmail(recipientId);
            if (recipientEmail == null || recipientEmail.isBlank()) return;

            String dashboardUrl = baseUrl + "/pages/auctioneer-dashboard?lot=" + event.getLotId();

            emailService.sendTemplatedEmail(
                    recipientEmail,
                    "New question on your lot",
                    "question-received",
                    java.util.Map.of(
                            "lotTitle",         "Lot " + event.getLotId(),
                            "bidderDisplayName", event.getBidderDisplayName(),
                            "category",         event.getCategory(),
                            "contentPreview",   event.getContentPreview(),
                            "submittedAt",      event.getSubmittedAt().toString(),
                            "dashboardUrl",     dashboardUrl
                    )
            );
            log.info("[Notification] question-received sent to auctioneer for lot {}",
                    event.getLotId());
        } catch (Exception e) {
            log.error("[Notification] Failed to send question-received for {}: {}",
                    event.getQuestionId(), e.getMessage());
        }
    }

    /**
     * Question answered privately — notify the bidder.
     * Not fired for public answers (they are visible in the room).
     */
    @KafkaListener(topics = LotQuestionAnsweredEvent.TOPIC,
                   groupId = "notification-service-group")
    public void onQuestionAnswered(LotQuestionAnsweredEvent event) {
        if (event.isAnsweredPublicly()) return; // visible in room — no email needed
        try {
            if (event.getBidderEmail() == null || event.getBidderEmail().isBlank()) return;

            String auctionRoomUrl = baseUrl + "/pages/auction-room?lot=" + event.getLotId();
            emailService.sendTemplatedEmail(
                    event.getBidderEmail(),
                    "Your question has been answered",
                    "question-answered",
                    java.util.Map.of(
                            "lotTitle",       "Lot " + event.getLotId(),
                            "questionContent", "Your question",
                            "response",       event.getResponsePreview(),
                            "auctionRoomUrl", auctionRoomUrl
                    )
            );
            log.info("[Notification] question-answered sent to bidder {} for lot {}",
                    event.getBidderId(), event.getLotId());
        } catch (Exception e) {
            log.error("[Notification] Failed to send question-answered for {}: {}",
                    event.getQuestionId(), e.getMessage());
        }
    }

    /**
     * Question escalated to support — notify the bidder with ticket reference.
     */
    @KafkaListener(topics = LotQuestionEscalatedEvent.TOPIC,
                   groupId = "notification-service-group")
    public void onQuestionEscalated(LotQuestionEscalatedEvent event) {
        try {
            if (event.getBidderEmail() == null || event.getBidderEmail().isBlank()) return;

            String ticketId  = event.getQuestionId().substring(0, 8).toUpperCase();
            String messagesUrl = baseUrl + "/pages/messages";

            emailService.sendTemplatedEmail(
                    event.getBidderEmail(),
                    "Your concern has been escalated — Ref: " + ticketId,
                    "question-escalated",
                    java.util.Map.of(
                            "lotTitle",      "Lot " + event.getLotId(),
                            "ticketId",      "TKT-" + ticketId,
                            "responseHours", "24",
                            "messagesUrl",   messagesUrl
                    )
            );
            log.info("[Notification] question-escalated sent to bidder {} for lot {}",
                    event.getBidderId(), event.getLotId());
        } catch (Exception e) {
            log.error("[Notification] Failed to send question-escalated for {}: {}",
                    event.getQuestionId(), e.getMessage());
        }
    }

    // ─── Credential events ────────────────────────────────────────────────

    @KafkaListener(topics = BiddingCredentialIssuedEvent.TOPIC,
                   groupId = "notification-service-group")
    public void onCredentialIssued(BiddingCredentialIssuedEvent event) {
        try {
            if (event.getBidderEmail() == null || event.getBidderEmail().isBlank()) return;
            String auctionRoomUrl = baseUrl + "/pages/auction-room?lot=" + event.getLotId();
            emailService.sendTemplatedEmail(
                    event.getBidderEmail(),
                    "You're cleared to bid on " + event.getLotTitle(),
                    "credential-issued",
                    java.util.Map.of(
                            "lotTitle",        event.getLotTitle(),
                            "auctionStartsAt", event.getAuctionStartsAt(),
                            "issuedAt",        event.getIssuedAt().toString(),
                            "expiresAt",       event.getExpiresAt().toString(),
                            "auctionRoomUrl",  auctionRoomUrl
                    )
            );
            log.info("[Notification] credential-issued sent to {} for lot {}",
                    event.getBidderEmail(), event.getLotId());
        } catch (Exception e) {
            log.error("[Notification] Failed to send credential-issued for {}: {}",
                    event.getCredentialId(), e.getMessage());
        }
    }

    @KafkaListener(topics = BiddingCredentialRevokedEvent.TOPIC,
                   groupId = "notification-service-group")
    public void onCredentialRevoked(BiddingCredentialRevokedEvent event) {
        try {
            if (event.getBidderEmail() == null || event.getBidderEmail().isBlank()) return;
            String messagesUrl = baseUrl + "/pages/messages";
            emailService.sendTemplatedEmail(
                    event.getBidderEmail(),
                    "Your bidding credential has been revoked",
                    "credential-revoked",
                    java.util.Map.of(
                            "lotId",       event.getLotId(),
                            "lotTitle",    "Lot " + event.getLotId(),
                            "reason",      event.getRevokeReason() != null ? event.getRevokeReason() : "",
                            "messagesUrl", messagesUrl
                    )
            );
            log.info("[Notification] credential-revoked sent to {} for lot {}",
                    event.getBidderEmail(), event.getLotId());
        } catch (Exception e) {
            log.error("[Notification] Failed to send credential-revoked for {}: {}",
                    event.getCredentialId(), e.getMessage());
        }
    }

    /**
     * Resolve a user's email from their user ID.
     * Placeholder — replace with Feign call to auth-service in production.
     */
    private String resolveEmail(String userId) {
        // TODO: Feign client to auth-service GET /api/v1/auth/users/{userId}/email
        return null;
    }

}