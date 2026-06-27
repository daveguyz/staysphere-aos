package com.staysphere.shared.events;

import lombok.*;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class BiddingCredentialIssuedEvent {
    public static final String TOPIC = "bid.credential-issued";

    private String eventId;
    private String credentialId;
    private String lotId;
    private String lotTitle;
    private String bidderId;
    private String bidderEmail;
    private LocalDateTime issuedAt;
    private LocalDateTime expiresAt;
    private String auctionStartsAt; // ISO string for email display
}
