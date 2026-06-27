package com.staysphere.auctionservice.service;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.shared.events.BiddingCredentialIssuedEvent;
import com.staysphere.shared.events.BiddingCredentialRevokedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Issues, validates, revokes, and expires bidding credentials.
 *
 * A BiddingCredential is a time-limited, lot-scoped token that proves:
 *   1. The bidder has been approved to bid on this lot (BidAccessRequest)
 *   2. The bidder has paid their deposit (BidderDeposit HELD)
 *   3. They hold a current, non-revoked, non-expired token
 *
 * The plaintext UUID token is returned ONCE from issueCredential() and
 * never persisted — only the SHA-256 hex digest is stored.
 * The caller (DepositService) is responsible for delivering it to the client.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class BiddingCredentialService {

    private final BiddingCredentialRepository credentialRepository;
    private final BidderDepositRepository depositRepository;
    private final AuctionLotRepository lotRepository;
    private final KafkaTemplate<String, Object> kafkaTemplate;

    /** Grace period after lot ends — keeps credential valid during settlement */
    private static final int EXPIRY_GRACE_MINUTES = 30;

    // ═══════════════════════════════════════════════════════════
    // ISSUANCE
    // ═══════════════════════════════════════════════════════════

    /**
     * Issue a bidding credential after a deposit hold is confirmed.
     *
     * Called by DepositService.onDepositConfirmed() — not directly by the HTTP layer.
     *
     * @param lotId     the auction lot
     * @param bidderId  bidder's user ID
     * @param email     bidder's email for notification
     * @param depositId FK to the BidderDeposit that authorised issuance
     * @param ipAddress IP at deposit time (fraud baseline for Phase 6)
     * @return IssuedCredential record containing the plaintext token (return ONCE)
     */
    @Transactional
    public IssuedCredential issueCredential(String lotId, String bidderId,
                                             String email, String depositId,
                                             String ipAddress) {

        // Idempotency: if this deposit already has a credential, return a new token
        // but reuse the same credential record (handles webhook retries)
        if (credentialRepository.existsByDepositId(depositId)) {
            log.warn("[Credential] Duplicate issuance attempt for deposit {} — lot {}",
                    depositId, lotId);
            throw new IllegalStateException(
                    "A credential has already been issued for deposit " + depositId);
        }

        AuctionLot lot = lotRepository.findById(lotId)
                .orElseThrow(() -> new IllegalArgumentException("Lot not found: " + lotId));

        // Credential expires 30 min after the lot's scheduled end
        LocalDateTime expiresAt = lot.getScheduledEndsAt()
                .plusMinutes(EXPIRY_GRACE_MINUTES);

        // Generate plaintext token (UUID v4) — returned once, never stored
        String plaintextToken = UUID.randomUUID().toString();
        String tokenHash      = sha256hex(plaintextToken);

        BiddingCredential credential = BiddingCredential.builder()
                .lotId(lotId)
                .bidderId(bidderId)
                .bidderEmail(email)
                .depositId(depositId)
                .tokenHash(tokenHash)
                .ipIssuedTo(ipAddress)
                .status(CredentialStatus.ACTIVE)
                .expiresAt(expiresAt)
                .bidCountUsed(0)
                .build();

        BiddingCredential saved = credentialRepository.save(credential);

        log.info("[Credential] Issued credential {} for bidder {} on lot {} (expires {})",
                saved.getId(), bidderId, lotId, expiresAt);

        // Notify bidder via email
        kafkaTemplate.send(BiddingCredentialIssuedEvent.TOPIC,
                BiddingCredentialIssuedEvent.builder()
                        .eventId(UUID.randomUUID().toString())
                        .credentialId(saved.getId())
                        .lotId(lotId)
                        .lotTitle(lot.getTitle())
                        .bidderId(bidderId)
                        .bidderEmail(email)
                        .issuedAt(saved.getIssuedAt())
                        .expiresAt(expiresAt)
                        .auctionStartsAt(lot.getStartsAt().toString())
                        .build());

        return new IssuedCredential(saved.getId(), plaintextToken, expiresAt);
    }

    // ═══════════════════════════════════════════════════════════
    // VALIDATION — called by BidEngineService on every bid
    // ═══════════════════════════════════════════════════════════

    /**
     * Validate a credential token presented with a bid.
     *
     * Checks (in order):
     *   1. Token hashes to a known credential
     *   2. Credential belongs to this bidder on this lot
     *   3. Status is ACTIVE
     *   4. Not expired
     *
     * On success: increments bidCountUsed (persisted immediately).
     *
     * @param lotId    the lot being bid on
     * @param bidderId the bidder placing the bid
     * @param token    the plaintext token from the client
     * @throws CredentialInvalidException with a machine-readable code on failure
     */
    @Transactional
    public BiddingCredential validateAndConsume(String lotId, String bidderId, String token) {

        if (token == null || token.isBlank()) {
            throw new CredentialInvalidException(
                    "CREDENTIAL_MISSING", "A bidding credential is required to bid on this lot");
        }

        String hash = sha256hex(token);
        BiddingCredential credential = credentialRepository.findByTokenHash(hash)
                .orElseThrow(() -> new CredentialInvalidException(
                        "CREDENTIAL_NOT_FOUND", "Invalid bidding credential"));

        // Lot and bidder match
        if (!lotId.equals(credential.getLotId())) {
            throw new CredentialInvalidException(
                    "CREDENTIAL_WRONG_LOT", "This credential is not valid for lot " + lotId);
        }
        if (!bidderId.equals(credential.getBidderId())) {
            throw new CredentialInvalidException(
                    "CREDENTIAL_WRONG_BIDDER", "This credential does not belong to you");
        }

        // Status
        if (credential.getStatus() == CredentialStatus.REVOKED) {
            throw new CredentialInvalidException(
                    "CREDENTIAL_REVOKED",
                    "Your bidding credential has been revoked"
                    + (credential.getRevokeReason() != null
                        ? ": " + credential.getRevokeReason() : ""));
        }
        if (credential.getStatus() == CredentialStatus.EXPIRED) {
            throw new CredentialInvalidException(
                    "CREDENTIAL_EXPIRED", "Your bidding credential has expired");
        }

        // Time-based expiry (belt-and-suspenders — status field may lag scheduler)
        if (LocalDateTime.now().isAfter(credential.getExpiresAt())) {
            credential.setStatus(CredentialStatus.EXPIRED);
            credentialRepository.save(credential);
            throw new CredentialInvalidException(
                    "CREDENTIAL_EXPIRED", "Your bidding credential has expired");
        }

        // Consume: increment bid count
        credential.setBidCountUsed(credential.getBidCountUsed() + 1);
        return credentialRepository.save(credential);
    }

    /**
     * Check whether a bidder holds an ACTIVE credential for a lot.
     * Lightweight existence check — does not consume the credential.
     * Used by the frontend to determine which UI state to show.
     */
    public boolean hasActiveCredential(String lotId, String bidderId) {
        return credentialRepository.existsByLotIdAndBidderIdAndStatus(
                lotId, bidderId, CredentialStatus.ACTIVE);
    }

    /**
     * Get credential status for a bidder on a lot (for frontend polling).
     * Returns a lightweight status DTO — never the token hash.
     */
    public CredentialStatusView getStatus(String lotId, String bidderId) {
        return credentialRepository
                .findByLotIdAndBidderIdAndStatus(lotId, bidderId, CredentialStatus.ACTIVE)
                .map(c -> new CredentialStatusView(
                        c.getId(), CredentialStatus.ACTIVE, c.getExpiresAt(), c.getBidCountUsed()))
                .orElseGet(() -> {
                    // Check for revoked / expired
                    List<BiddingCredential> all = credentialRepository
                            .findByLotIdAndStatus(lotId, CredentialStatus.REVOKED);
                    all.addAll(credentialRepository.findByLotIdAndStatus(
                            lotId, CredentialStatus.EXPIRED));
                    return all.stream()
                            .filter(c -> c.getBidderId().equals(bidderId))
                            .findFirst()
                            .map(c -> new CredentialStatusView(
                                    c.getId(), c.getStatus(), c.getExpiresAt(),
                                    c.getBidCountUsed()))
                            .orElse(new CredentialStatusView(null,
                                    null, null, 0));
                });
    }

    // ═══════════════════════════════════════════════════════════
    // REVOCATION — auctioneer action
    // ═══════════════════════════════════════════════════════════

    /**
     * Revoke a credential mid-auction (Rule 11.3: auctioneer may disqualify any bidder).
     *
     * @param credentialId the credential to revoke
     * @param revokedBy    auctioneer's user ID (must be auctioneer or seller of the lot)
     * @param reason       reason for revocation (required — included in bidder notification)
     */
    @Transactional
    public BiddingCredential revokeCredential(String credentialId,
                                               String revokedBy, String reason) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("A reason for revocation is required");
        }

        BiddingCredential credential = credentialRepository.findById(credentialId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Credential not found: " + credentialId));

        if (credential.getStatus() != CredentialStatus.ACTIVE) {
            throw new IllegalStateException(
                    "Cannot revoke a credential with status: " + credential.getStatus());
        }

        credential.setStatus(CredentialStatus.REVOKED);
        credential.setRevokeReason(reason);
        credential.setRevokedBy(revokedBy);
        credential.setRevokedAt(LocalDateTime.now());
        BiddingCredential saved = credentialRepository.save(credential);

        log.info("[Credential] Credential {} revoked by {} — reason: {}",
                credentialId, revokedBy, reason);

        kafkaTemplate.send(BiddingCredentialRevokedEvent.TOPIC,
                BiddingCredentialRevokedEvent.builder()
                        .eventId(UUID.randomUUID().toString())
                        .credentialId(credentialId)
                        .lotId(credential.getLotId())
                        .bidderId(credential.getBidderId())
                        .bidderEmail(credential.getBidderEmail())
                        .revokeReason(reason)
                        .revokedBy(revokedBy)
                        .revokedAt(saved.getRevokedAt())
                        .build());

        return saved;
    }

    /** All credentials for a lot — for the auctioneer Bidders tab. */
    public List<BiddingCredential> getCredentialsForLot(String lotId) {
        return credentialRepository.findByLotIdOrderByIssuedAtDesc(lotId);
    }

    // ═══════════════════════════════════════════════════════════
    // EXPIRY — settlement + scheduled cleanup
    // ═══════════════════════════════════════════════════════════

    /**
     * Called by AuctionSettlementService after lot closes.
     * Bulk-expires all remaining ACTIVE credentials for the lot.
     */
    @Transactional
    public int expireAllForLot(String lotId) {
        int count = credentialRepository.expireAllForLot(lotId);
        log.info("[Credential] {} credentials expired for closed lot {}", count, lotId);
        return count;
    }

    /** Daily scheduled job — expire any credentials past their expiresAt. */
    @Scheduled(cron = "0 0 2 * * *") // 02:00 daily
    @Transactional
    public void expireStaleCredentials() {
        int count = credentialRepository.expireStale(LocalDateTime.now());
        if (count > 0) {
            log.info("[Credential] Daily cleanup: {} stale credentials expired", count);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DTOs
    // ═══════════════════════════════════════════════════════════

    /**
     * Returned from issueCredential(). The plaintext token is returned
     * exactly once and must be delivered to the client immediately.
     */
    public record IssuedCredential(
            String credentialId,
            String plaintextToken,   // NEVER store this — deliver to client and discard
            LocalDateTime expiresAt
    ) {}

    /**
     * Safe view for the frontend — never exposes tokenHash.
     */
    public record CredentialStatusView(
            String credentialId,
            CredentialStatus status,
            LocalDateTime expiresAt,
            int bidCountUsed
    ) {}

    /**
     * Thrown by validateAndConsume() with a machine-readable code so the
     * WebSocket controller can send a structured error to the client.
     */
    public static class CredentialInvalidException extends RuntimeException {
        private final String code;
        public CredentialInvalidException(String code, String message) {
            super(message);
            this.code = code;
        }
        public String getCode() { return code; }
    }

    // ═══════════════════════════════════════════════════════════
    // Crypto helper
    // ═══════════════════════════════════════════════════════════

    static String sha256hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
