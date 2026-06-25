package com.staysphere.shared.events;

import lombok.*;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionLotExtendedEvent {
    public static final String TOPIC = "auction.lot.extended";
    private String eventId;
    private String auctionLotId;
    private Integer extensionNumber;
    private Integer maxExtensions;
    private LocalDateTime newEndTime;
    private String triggeringBidId;
    private LocalDateTime occurredAt;
}
