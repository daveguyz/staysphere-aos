package com.staysphere.auctionservice.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * A time-limited, lot-scoped cryptographic credential that authorises
 * a specific bidder to participate in a specific live auction.
 *
 * Issued automatically after a deposit hold is confirmed (Phase 4 → Phase 5).
 * Validated by BidEngineService on every bid attempt.
 * Expires at lot.scheduledEndsAt + 30 minutes (grace period for settlement).
 *
 * Security design:
 *   - The plaintext token (UUID v4) is returned ONCE to the caller and never stored.
 *   - Only the SHA-256 hex digest is persisted (tokenHash).
 *   - The frontend stores the plaintext token in sessionStorage (cleared on tab close).
 *   - On each bid, the token is hashed client-side and compared against tokenHash here.
 *     (Hashing is done server-side on the received token — client sends plaintext over HTTPS.)
 */
@Entity
@Table(name = "bidding_credentials", indexes = {
    @Index(name = "idx_cred_lot",    columnList = "lot_id"),
    @Index(name = "idx_cred_bidder", columnList = "bidder_id"),
    @Index(name = "idx_cred_status", columnList = "status"),
    @Index(name = "idx_cred_hash",   columnList = "token_hash", unique = true)
})
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class BiddingCredential {

    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "lot_id", nullable = false)
    private String lotId;

    @Column(name = "bidder_id", nullable = false)
    private String bidderId;

    @Column(name = "bidder_email")
    private String bidderEmail;

    /** FK to the deposit that authorised credential issuance */
    @Column(name = "deposit_id", nullable = false)
    private String depositId;

    /** SHA-256 hex digest of the plaintext token — never the raw token */
    @Column(name = "token_hash", nullable = false, length = 64, unique = true)
    private String tokenHash;

    /** IP address captured at deposit time — used for fraud correlation in Phase 6 */
    @Column(name = "ip_issued_to", length = 64)
    private String ipIssuedTo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private CredentialStatus status = CredentialStatus.ACTIVE;

    @CreationTimestamp
    @Column(name = "issued_at", nullable = false, updatable = false)
    private LocalDateTime issuedAt;

    /** lot.scheduledEndsAt + 30 min — allows bid settlement to complete */
    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    /** Total number of bids placed under this credential — incremented per bid */
    @Column(name = "bid_count_used", nullable = false)
    @Builder.Default
    private Integer bidCountUsed = 0;

    // ── Revocation fields ─────────────────────────────────────────────
    @Column(name = "revoke_reason", columnDefinition = "TEXT")
    private String revokeReason;

    @Column(name = "revoked_by")
    private String revokedBy;

    @Column(name = "revoked_at")
    private LocalDateTime revokedAt;
}
