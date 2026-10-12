# Lokálna aplikácia a telefón cez Wi-Fi

MOMS beží u používateľa na počítači alebo v jeho Dockeri. Objednávky, nastavenia
aj databáza zostávajú lokálne. Telefón je druhý klient tej istej aplikácie.

1. Pripojte telefón k rovnakej Wi-Fi ako počítač.
2. Na počítači kliknite na **Pripojiť telefón** a naskenujte QR kód.
3. Prihláste sa svojím používateľským menom a heslom aplikácie.

Príklad lokálnej adresy je `http://192.168.1.100:3080`. Počítač musí zostať
zapnutý. Hosťovská Wi-Fi môže blokovať spojenie medzi zariadeniami.
Žiadna doména, Tailscale ani inštalácia certifikátu na telefóne sa nevyžaduje.
Pôvodný odkaz `/phone-setup` presmeruje na aplikáciu.

## Docker

Pri otvorení aplikácie cez LAN adresu počítača QR použije tú istú adresu.
Ak na počítači používate `localhost`, nastavte raz pri inštalácii v `.env`
`MOMS_LAN_ADDRESS` na Wi-Fi/LAN IPv4 adresu počítača a spustite
`docker compose up -d app`. QR nikdy nepoužije internú adresu Docker kontajnera.
Natívna aplikácia pri otvorení cez localhost nájde lokálnu sieťovú adresu sama.

Hostiteľský firewall musí povoľovať port aplikácie pre lokálnu sieť. Zachovajte
LAN adresu počítača, napríklad DHCP rezerváciou. OAuth `APP_BASE_URL` neovplyvňuje
adresu telefónu. Nevyžaduje sa zverejnenie aplikácie na internete.

## Voliteľné HTTPS

Bežný prístup a práca s objednávkami fungujú cez HTTP. Plná PWA, push a
jednorazové bezpečné párovanie vyžadujú dôveryhodné HTTPS; sú voliteľné.
Na HTTP QR obsahuje iba adresu a používa bežné prihlásenie. Heslo preto cez
HTTP nemá ochranu TLS; tento prístup patrí do dôveryhodnej lokálnej siete.

Správca môže nastaviť existujúci dôveryhodný certifikát a lokálne DNS podľa
[desktopovej dokumentácie](DESKTOP.md). Tým sa nemení lokálne uloženie dát.
Manuálny sprievodca inštaláciou CA a sťahovanie certifikátov boli odstránené.
Predchádzajúce Caddy volume sa pri nasadení nemaže; voliteľný proxy profil nie je
súčasťou základného spustenia.

## Voliteľný súkromný prístup cez Tailscale

Živá kamera potrebuje dôveryhodné HTTPS. Na počítači s MOMS môžete nastaviť
súkromný Tailscale Serve podľa [desktopovej dokumentácie](DESKTOP.md).
Použite vlastný názov zariadenia a siete, napríklad
`https://your-device.your-tailnet.ts.net:8443/#scan`. Zariadenia musia mať
prístup do tej istej siete Tailscale.

`MOMS_SCAN_HTTPS_URL` nastavuje HTTPS odkaz ponúkaný Scanom na HTTP.
Pri proxy dôverujte iba skutočnej adrese svojho proxy servera. Adresu overte
vo vlastnej inštalácii; príklady nie sú nastavenia vašej siete.

Pri problémoch s DNS alebo iCloud Private Relay overte súkromné DNS a prístup
na zariadení. Vlastná CA a Caddy sú voliteľné správcovské konfigurácie;
certifikátu dôverujte až po overení jeho pôvodu a fingerprintu.
Súkromné kľúče nepatria do repozitára ani do zdieľaných príloh.

## Skratka na iPhone

Pri **Pridať na plochu** použite autentifikovaný `/api/webapp-profile` na
HTTPS adrese svojej aplikácie. Stiahnutý `moms-webapp.mobileconfig` obsahuje
jediný odstrániteľný Web Clip: adresu aplikácie, názov a vloženú PNG ikonu.
Neobsahuje prihlasovacie údaje, certifikát ani správu zariadenia. Profil musí
používateľ nainštalovať v Nastaveniach; jeho odstránením sa odstráni aj skratka.
