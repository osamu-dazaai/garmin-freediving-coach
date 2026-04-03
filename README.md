# ApneaOS 🌊🤿

**AI-powered freediving training coach — Garmin data + React Native mobile app**

![Status](https://img.shields.io/badge/status-live-brightgreen)
![Backend](https://img.shields.io/badge/backend-FastAPI%20%2F%20Python-blue)
![Mobile](https://img.shields.io/badge/mobile-Expo%20React%20Native-purple)

---

## What is This?

ApneaOS is a personal freediving coach that lives on your phone. It pulls data from your Garmin watch, analyzes your dives, tracks recovery, and helps you push to new personal bests — all stored privately on your own server.

**Core loop:**
```
Garmin Connect → Python backend (FastAPI) → SQLite → Expo mobile app
```

---

## Current Architecture

### Backend — Python / FastAPI
- **Path:** `backend/`
- **Port:** 8504
- **Stack:** FastAPI, SQLite, python-garminconnect, garth
- **Routers:** sessions, dives, health, readiness, goals, analytics, protocols, manual log

### Mobile — Expo React Native
- **Path:** `mobile/`
- **Port:** 8081 (Expo dev server)
- **Stack:** Expo, React Native, React Query, Apollo-style local state
- **Screens:** Dashboard, Session Detail, Dive Detail, Analytics, Goals, Profile

---

## What's Built

### ✅ Data & Sync
- Full Garmin Connect data extraction (dives, HR, HRV, sleep, stress, Body Battery)
- FIT file parsing for raw dive profiles
- Manual dive log entry

### ✅ Dive Tracking
- Session list with depth, bottom time, dive count, surface intervals
- Per-dive detail: depth profile, HR during apnea, mammalian dive reflex tracking
- AI discipline classification (CWT, FIM, DNF, DYN, STA, etc.)
- Personal best detection and history

### ✅ Recovery & Readiness
- HRV trend analysis
- Sleep quality scoring
- Daily readiness score (composite of HRV, sleep, training load)
- Body Battery tracking

### ✅ Training
- Protocol library (CO₂ tables, O₂ tables, depth progression)
- Working depth tracking
- Training load monitoring
- Session navigation (swipe between sessions)

### ✅ Goals
- Custom goal setting (depth, bottom time, dive count)
- Progress tracking toward goals

### ✅ Analytics
- Long-term progression charts
- PB timeline
- Session comparison

### ✅ Mobile UX
- ApneaOS design system (dark theme, cyan accents)
- Session sharing (formatted text export)
- Session notes + conditions logging (water temp, visibility, current, etc.)

---

## Quick Start

### Backend
```bash
cd garmin-freediving
backend/venv/bin/python -m backend.run
# Runs on http://localhost:8504
```

### Mobile
```bash
cd garmin-freediving/mobile
npx expo start --port 8081
```

### Configuration
```bash
cp .env.example .env
# Set: GARMIN_EMAIL, GARMIN_PASSWORD, API_KEY
```

---

## Project Status

### ✅ Phase 0: Planning
- Feasibility analysis, architecture design, database schema

### ✅ Phase 1: Foundation
- python-garminconnect integration
- SQLite database + data pipeline
- Initial data sync

### ✅ Phase 2: Analysis
- HRV analyzer, dive session parser, readiness calculator
- AI dive classification (discipline + lung volume detection)

### ✅ Phase 3: Intelligence
- Training plan generator, protocol library
- Working depth tracking
- User baselines

### ✅ Phase 4: Mobile App (ApneaOS)
- Full Expo React Native app
- Session detail, dive detail, analytics, goals
- ApneaOS design system

### 🚧 Phase 5: In Progress / Next Up
- [ ] Push notifications for readiness and training reminders
- [ ] Mares watch support (via libdivecomputer / UDDF import)
- [ ] Competition taper planner

---

## Planned Features

### 🎉 PB Celebrations (Community)
Celebrate personal bests with friends — "PB cake" and "PB coffee" moments.
- Notify friends when you hit a new PB
- Friends can be prompted to celebrate when they hit theirs
- Shared milestone feed
- Foundation for broader community / social features

### 👩 Women's Feature — Menstrual Cycle Tracking
A dedicated section for women to log and correlate menstrual cycles with dive performance.
- Cycle phase logging
- Correlate phase with readiness score, depth, breath hold times
- Personalized training recommendations based on cycle phase
- Research-backed guidance on breath hold and equalization through cycle phases

### 🏃 Cross-Training Impact Tracking
Track how gym sessions, running, swimming, and other activities affect freediving performance.
- Log cross-training sessions (type, duration, intensity)
- Correlate with next-session readiness and dive performance
- Identify which activities help vs. hinder recovery
- Build a personal activity-to-performance model over time

---

## Roadmap

### Near Term
- Push notifications
- Mares / UDDF import support
- Competition taper planner
- PB celebration & community features (see above)

### Medium Term
- Women's cycle tracking (see above)
- Cross-training impact tracker (see above)
- Predictive modeling (forecast PBs based on training trends)
- Apple Watch / HealthKit integration

### Long Term
- Multi-user / friends social layer
- Video analysis for technique
- Integration with other sensors (Moxy, O₂ rings)

---

## Data Privacy

- All data stored locally on your own server
- No third-party access to Garmin data
- Encrypted credentials via Garth OAuth tokens
- You own everything

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| Mobile | Expo, React Native, TypeScript, React Query |
| Backend | Python 3.12, FastAPI, SQLite |
| Garmin sync | python-garminconnect, garth, FIT SDK |
| Analysis | Pandas, NumPy |
| Infra | Ubuntu VPS, systemd / manual process |

---

## Contact

Personal project for Neko. Questions? Discord.
