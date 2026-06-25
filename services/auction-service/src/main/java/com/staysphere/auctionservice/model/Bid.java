package com.staysphere.auctionservice.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "bids", indexes = {
    @Index(name = "idx_bid_lot",    columnList = "auction_lot_id"),
    @Index(name = "idx_bid_bidder", columnList = "bidder_id"),
    @Index(name = "idx_bid_status", columnList = "status"),
    @Index(name = "idx_bid_amount", columnList = "amount")
})
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class Bid {

    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String auctionLotId;

    @Column(nullable = false)
    private String bidderId;

    @Column(nullable = false)
    private String bidderEmail;

    // The actual bid amount (for English/Dutch/Reverse)
    @Column(nullable = false, precision = 14, scale = 2)
    private BigDecimal amount;

    // Proxy bid ceiling — the maximum this bidder is willing to pay.
    // The system autobids up to this ceiling against competing bids.
    // Null = no proxy (manual bidding only).
    @Column(precision = 14, scale = 2)
    private BigDecimal proxyCeiling;

    // For sealed bid auctions — encrypted until reveal at close
    @Column(columnDefinition = "TEXT")
    private String sealedBidHash;

    private Boolean isSealed;

    @Enumerated(EnumType.STRING) @Column(nullable = false)
    @Builder.Default
    private BidStatus status = BidStatus.ACTIVE;

    // Fraud prevention metadata
    private String ipAddress;
    private String deviceFingerprint;
    private String userAgent;

    // AI fraud score (0.0 = clean, 1.0 = likely fraud)
    @Column(precision = 5, scale = 4)
    @Builder.Default
    private BigDecimal fraudScore = BigDecimal.ZERO;

    private Boolean flaggedForReview;

    // Anti-snipe — did this bid trigger an extension?
    @Builder.Default
    private Boolean triggeredAntiSnipe = false;

    @Column(nullable = false, length = 10)
    @Builder.Default
    private String currency = "NAD";

    // The lot's time-remaining when bid was placed (ms) — useful for sniping analysis
    private Long msRemainingAtBid;

    @CreationTimestamp
    private LocalDateTime placedAt;

    // Set when outbid
    private LocalDateTime outbidAt;

    // Sequence within the lot (monotonically increasing, used for tie-breaking)
    private Long bidSequence;
}
