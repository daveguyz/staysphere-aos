package com.staysphere.shared.events;

import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionBidPlacedEvent {
    public static final String TOPIC = "auction.bid.placed";
    private String eventId;
    private String auctionLotId;
    private String bidId;
    private String bidderId;
    private String bidderEmail;
    private BigDecimal amount;
    private String currency;
    private Integer totalBids;
    private Boolean antiSnipeExtended;
    private LocalDateTime newEndTime;
    private LocalDateTime occurredAt;
}
