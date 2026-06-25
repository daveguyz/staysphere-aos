package com.staysphere.auctionservice;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(scanBasePackages = {"com.staysphere.auctionservice", "com.staysphere.shared"})
@EnableFeignClients
public class AuctionServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(AuctionServiceApplication.class, args);
    }
}
