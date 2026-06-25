package com.staysphere.auctionservice.config;

import com.staysphere.shared.security.JwtAuthenticationFilter;
import com.staysphere.shared.security.SecurityConstants;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.*;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration @EnableWebSecurity @RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtFilter;

    @Bean
    public SecurityWebFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(c -> c.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public: browse lots, view bid history, join room (WS returns state but bidding requires auth)
                        .requestMatchers("/api/v1/auctions", "/api/v1/auctions/live",
                                         "/api/v1/auctions/*/bids", "/actuator/health").permitAll()
                        .requestMatchers("/ws/auction/**").permitAll()
                        // Everything else requires a valid JWT
                        .anyRequest().authenticated()
                )
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
                .build();
    }
}
