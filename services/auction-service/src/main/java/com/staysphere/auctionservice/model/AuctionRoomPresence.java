package com.staysphere.auctionservice.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import java.time.LocalDateTime;

@Entity
@Table(name = "auction_room_presence")
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class AuctionRoomPresence {

    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false) private String auctionLotId;
    @Column(nullable = false) private String sessionId;
    private String userId;       // null for anonymous viewers
    private String userEmail;
    private String ipAddress;

    @CreationTimestamp private LocalDateTime joinedAt;
    private LocalDateTime leftAt;
    private Boolean isActive;
}
