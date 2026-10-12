CREATE TABLE marketplace_order_appearance (
 channel text PRIMARY KEY CHECK (channel IN ('etsy','shopify','amazon','sashe','manual','other')),
 background_color text CHECK (background_color ~ '^#[0-9a-f]{6}$'),
 background_alpha numeric(3,2) NOT NULL DEFAULT 0.15 CHECK (background_alpha BETWEEN 0 AND 0.5)
);
INSERT INTO marketplace_order_appearance(channel) VALUES ('etsy'),('shopify'),('amazon'),('sashe'),('manual'),('other');
