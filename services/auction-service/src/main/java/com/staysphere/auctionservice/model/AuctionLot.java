package com.staysphere.auctionservice.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Entity
@Table(name = "auction_lots", indexes = {
    @Index(name = "idx_lot_status",     columnList = "status"),
    @Index(name = "idx_lot_type",       columnList = "auction_type"),
    @Index(name = "idx_lot_starts_at",  columnList = "starts_at"),
    @Index(name = "idx_lot_property",   columnList = "property_id"),
    @Index(name = "idx_lot_seller",     columnList = "seller_id")
})
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionLot {

    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false)
    private String propertyId;

    @Column(nullable = false)
    private String sellerId;           // host user ID

    @Column(nullable = false, length = 300)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    // Auction configuration
    @Enumerated(EnumType.STRING) @Column(nullable = false)
    private AuctionType auctionType;

    @Enumerated(EnumType.STRING) @Column(nullable = false)
    @Builder.Default
    private AuctionLotStatus status = AuctionLotStatus.DRAFT;

    @Column(nullable = false)
    private LocalDateTime startsAt;

    @Column(nullable = false)
    private LocalDateTime scheduledEndsAt;

    private LocalDateTime actualEndsAt;  // may differ due to anti-snipe extensions

    // Pricing
    @Column(nullable = false, precision = 14, scale = 2)
    private BigDecimal startingPrice;

    @Column(precision = 14, scale = 2)
    private BigDecimal reservePrice;    // null = no reserve

    @Column(precision = 14, scale = 2)
    private BigDecimal buyItNowPrice;   // null = no BIN option

    @Column(nullable = false, precision = 14, scale = 2)
    @Builder.Default
    private BigDecimal minimumBidIncrement = BigDecimal.valueOf(100); // NAD

    @Column(nullable = false, length = 10)
    @Builder.Default
    private String currency = "NAD";

    // Dutch auction specific
    @Column(precision = 14, scale = 2)
    private BigDecimal dutchStartPrice;  // starting high price

    @Column(precision = 14, scale = 2)
    private BigDecimal dutchFloorPrice;  // minimum accept price

    @Column(precision = 14, scale = 2)
    private BigDecimal dutchDecrementAmount; // price drop per interval

    private Integer dutchDecrementIntervalSeconds;

    // Anti-snipe configuration
    @Builder.Default
    private Boolean antiSnipeEnabled = true;

    @Builder.Default
    private Integer antiSnipeTriggerSeconds = 300;   // bid in last 5 min triggers extension

    @Builder.Default
    private Integer antiSnipeExtensionSeconds = 300; // extend by 5 min

    @Builder.Default
    private Integer maxAntiSnipeExtensions = 10;     // prevent infinite loop

    @Builder.Default
    private Integer antiSnipeExtensionCount = 0;     // how many times extended so far

    // Deposit requirements
    @Builder.Default
    private Boolean depositRequired = false;

    @Column(precision = 14, scale = 2)
    private BigDecimal depositAmount;

    // KYC requirements
    @Builder.Default
    private Boolean kycRequired = false;

    @Column(precision = 14, scale = 2)
    private BigDecimal kycThresholdAmount; // auto-require KYC if bid exceeds this

    // Current auction state (denormalized for fast reads)
    @Column(precision = 14, scale = 2)
    private BigDecimal currentBidAmount;

    private String currentLeadBidderId;
    private String currentLeadBidId;

    @Builder.Default
    private Integer totalBids = 0;

    @Builder.Default
    private Integer uniqueBidders = 0;

    // Winner
    private String winnerId;
    private String winningBidId;

    @Column(precision = 14, scale = 2)
    private BigDecimal winningAmount;

    // Livestream
    private String livestreamProvider;  // MUX, YOUTUBE, NONE
    private String livestreamKey;
    private String livestreamPlaybackId;
    private String livestreamUrl;
    private Boolean livestreamActive;

    // Images / documents
    @Column(columnDefinition = "TEXT")
    private String imageUrls;  // JSON array string

    @Column(columnDefinition = "TEXT")
    private String documentUrls;  // legal docs, title deeds etc.

    // Metadata
    private String termsAndConditions;
    private String propertyAddress;
    private String propertyCity;

    @CreationTimestamp private LocalDateTime createdAt;
    @UpdateTimestamp  private LocalDateTime updatedAt;

    // Transient: bids list (not stored here, fetched from bid table)
    @OneToMany(mappedBy = "auctionLotId", fetch = FetchType.LAZY, cascade = CascadeType.ALL)
    private List<Bid> bids;
}
