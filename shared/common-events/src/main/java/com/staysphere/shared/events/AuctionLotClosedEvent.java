package com.staysphere.shared.events;

import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionLotClosedEvent {
    public static final String TOPIC = "auction.lot.closed";
    private String eventId;
    private String auctionLotId;
    private String propertyId;
    private String sellerId;
    private String winnerId;       // null if no bids
    private BigDecimal winningAmount;
    private String currency;
    private Boolean hadWinner;
    private Boolean reserveMet;
    private LocalDateTime occurredAt;
}
