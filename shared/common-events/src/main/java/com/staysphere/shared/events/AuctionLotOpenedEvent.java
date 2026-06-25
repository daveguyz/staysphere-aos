package com.staysphere.shared.events;

import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionLotOpenedEvent {
    public static final String TOPIC = "auction.lot.opened";
    private String eventId;
    private String auctionLotId;
    private String auctionType;
    private String propertyId;
    private String sellerId;
    private BigDecimal startingPrice;
    private LocalDateTime scheduledEndsAt;
    private LocalDateTime occurredAt;
}
