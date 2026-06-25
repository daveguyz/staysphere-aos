package com.staysphere.auctionservice.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "bidder_deposits", indexes = {
    @Index(name = "idx_deposit_lot",    columnList = "auction_lot_id"),
    @Index(name = "idx_deposit_bidder", columnList = "bidder_id"),
    @Index(name = "idx_deposit_status", columnList = "status")
})
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class BidderDeposit {

    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false) private String auctionLotId;
    @Column(nullable = false) private String bidderId;
    @Column(nullable = false) private String bidderEmail;

    // Stripe authorisation hold (not charged until win)
    @Column(nullable = false) private String stripePaymentIntentId;
    private String stripeChargeId;      // set on capture

    @Column(nullable = false, precision = 14, scale = 2)
    private BigDecimal depositAmount;

    @Column(nullable = false, length = 10)
    @Builder.Default private String currency = "NAD";

    @Enumerated(EnumType.STRING) @Column(nullable = false)
    @Builder.Default private DepositStatus status = DepositStatus.PENDING;

    private LocalDateTime authorisedAt;
    private LocalDateTime releasedAt;
    private LocalDateTime chargedAt;

    private String releaseReason;  // "LOST", "CANCELLED", "EXPIRED"

    @CreationTimestamp private LocalDateTime createdAt;
}
