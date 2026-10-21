# BUSINESS OVERVIEW & SYSTEM SPECIFICATION DOCUMENT
**Merchant Application & Underwriting Compliance Profile**

---

### **Document Metadata**
* **Legal / Brand Name:** WipeClip (WipeClip.co)
* **Website URL:** [https://wipeclip.co](https://wipeclip.co)
* **Document Purpose:** Merchant Onboarding & Underwriting Compliance (Payment Gateway Review)
* **Merchant Category:** Software as a Service (SaaS) / Digital Content Processing & Media Retouching
* **Suggested MCC:** 7372 (Computer Programming, Data Processing, and Software Services)
* **Primary Contacts:** 
  * Support: `support@wipeclip.co`
  * Legal & Compliance: `legal@wipeclip.co` / `dmca@wipeclip.co`
* **Target Audience:** Content creators, video editors, filmmakers, social media managers, marketing agencies, and digital designers.

---

## 1. Executive Summary & Company Profile

**WipeClip.co** is a web-based video editing SaaS (Software as a Service) platform for content creators, videographers, editors, and digital agencies. Users edit video they shot themselves or are authorized to edit, directly in the browser, and export it at their original quality. The platform also includes a small set of AI-assisted photo utilities.

Common professional use cases include:
* Trimming, cutting, and assembling raw footage into finished videos.
* Adding text, captions, music, transitions, and filters to the user's own recordings.
* Resizing one video into landscape, vertical, square, and portrait formats for publishing.
* Preparing product photos and creative assets with background removal and sharpening.

The service is delivered 100% digitally through modern cloud infrastructure with zero physical shipping, providing immediate automated fulfillment upon payment.

---

## 2. Nature of the Business & Core Purpose

### 2.1 The Problem It Solves
Creators and small teams need to edit and publish video quickly, but professional desktop editing suites are expensive, heavy to install, and slow to learn. Many simple editing tasks (trimming, captioning, resizing for different formats) do not justify that overhead.

### 2.2 WipeClip's Solution
WipeClip provides an intuitive browser-based editor with a timeline, where users import their own clips, arrange and edit them, and export the result without installing software. AI-assisted features (such as automatic captions from speech) speed up repetitive work. Media is processed only to deliver the user's own export.

### 2.3 Product Capabilities & Tool Suite
* **Video Editor:** Trim, split, reorder, transitions, text, stickers, filters, music, picture-in-picture, and canvas presets for landscape, vertical, square, and portrait output.
* **Auto Captions:** Speech-to-text captions generated from the user's own audio.
* **Screen Recorder (desktop app):** Record the user's own screen and microphone for tutorials, then edit in the same app.
* **Complementary Creator Utilities:**
  * Background Remover (AI-powered subject isolation).
  * Video Frame Grabber (lossless frame extraction).
  * Photo Sharpener (detail enhancement).

---

## 3. Target Audience & User Personas

| User Persona | Typical Use Case | Value Proposition |
| :--- | :--- | :--- |
| **Independent Content Creators & Vloggers** | Editing and captioning their own footage before publishing. | Fast, free-to-start editing with no software install. |
| **Freelance Video Editors & Agencies** | Producing client videos from client-supplied footage. | Professional exports at original quality from any computer. |
| **Social Media Managers & Marketers** | Resizing their own promotional clips for different channels and formats. | One edit, exported in every aspect ratio. |
| **Educators & Tutorial Makers** | Recording and editing screen tutorials. | Recorder and editor in one workflow. |
| **Digital Photographers & Graphic Artists** | Cutting out backgrounds and sharpening product photos. | Single-click utilities with no heavy desktop software required. |

---

## 4. Business & Revenue Model

WipeClip operates on a **Transparent Prepaid Pass & Pay-As-You-Go (PAYG) Credit Model**. 

> **Important Risk Mitigation Note:** WipeClip intentionally utilizes **fixed, pre-paid passes and one-time credit bundles rather than hidden recurring auto-renewals**. This significantly eliminates consumer disputes, unexpected renewals, and unauthorized chargeback risks.

### 4.1 Plan Breakdown & Pricing Structure

| Tier | Billing Mechanism | Price (Display / LKR Charged) | Credits Granted | Feature Inclusions |
| :--- | :--- | :--- | :--- | :--- |
| **Free Tier** | Free Trial (Sign-in bonus) | Free ($0) | 2 daily credits | Up to 720p processing, testing features. |
| **Creator Pack** | One-time purchase | **$1.99** (~Rs. 600 LKR) | 15 credits | Up to 1080p exports; non-expiring credits; ideal for single sessions. |
| **Pay-As-You-Go** | One-time purchase | **$5.99** (~Rs. 1,800 LKR) | 30 credits | Up to 1080p exports; non-expiring credits; ideal for occasional editing. |
| **Starter Pass** | 30-Day Prepaid Pass | **$8.99** (~Rs. 2,700 LKR) | 60 credits | Up to 1080p Full HD; priority queue; 30-day access (no auto-renewal). |
| **Pro Pass** | 30-Day Prepaid Pass | **$23.99** (~Rs. 7,200 LKR) | 200 credits | 4K Ultra HD exports unlocked; ultra-priority GPU lane; 30-day access. |

* **Credit Economics:**
  * 720p Video processing: 1 credit
  * 1080p Video processing: 2 credits
  * 4K Video processing: 4 credits
  * Image processing: 1 credit flat

---

## 5. Order Fulfillment & Service Delivery Flow

Service fulfillment is **fully automated and instantaneous**:

```
[User Selects Plan on /pricing]
               │
               ▼
[Initiates POST /api/checkout] 
──> Inserts record in `payment_orders` with idempotent reference
               │
               ▼
[Redirected to Hosted Payment Gateway Checkout] 
──> Securely enters payment credentials (PCI-DSS compliant hosted page)
               │
               ▼
[Payment Gateway Webhook: payment.succeeded]
               │
               ▼
[Cryptographic HMAC-SHA256 Signature Verification]
               │
               ▼
[Atomic Database Transaction via Supabase RPC `grant_paid_credits`]
──> Credits credited immediately & status set to 'paid'
               │
               ▼
[User redirected back to WipeClip Dashboard with Active Credits Ready to Use]
```

* **Fulfillment SLA:** Less than 5 seconds from payment confirmation to credit availability in user dashboard.
* **Digital Goods Notice:** No physical shipment, tracking numbers, or inventory delays are involved.

---

## 6. Legal, Copyright & Content Safety Compliance

WipeClip maintains a strict legal posture to guarantee ethical usage and protect payment processors and platform integrity:

### 6.1 Terms of Service & Ownership Representation
Under Section 3 of the [Terms of Service](https://wipeclip.co/terms), every user agrees to the following legally binding representations:
1. The user must own the content or have explicit written permission from the copyright owner to edit the media.
2. The user will not use the service to infringe copyright, evade mandatory platform disclosures, or facilitate deception.
3. The platform strictly prohibits processing pirated movies, third-party intellectual property without authorization, or infringing content.

### 6.2 Active Content Moderation & Abuse Prevention
* **Automated Screening Pipeline:** WipeClip integrates heuristic visual content moderation filters (e.g. NudeNet/computer vision inspection) on sampled frames prior to video processing.
* **Zero Tolerance:** Explicit content, non-consensual imagery, hate speech, and unlawful material are blocked automatically with HTTP 422 hard rejection before media enters rendering queues.

### 6.3 DMCA & Intellectual Property Takedown Protocol
* Compliant with 17 U.S.C. § 512(c)(3) (DMCA notice & takedown framework).
* Dedicated Designated Agent: `dmca@wipeclip.co` / `legal@wipeclip.co`.
* Repeat Infringer Policy: Prompt account suspension and permanent banning of any user flagged for repeat infringement.
* Clear disclaimer of non-affiliation with any third-party video platform, software vendor or AI model provider.

---

## 7. Data Privacy, Storage & Security Architecture

WipeClip adheres to a **zero-retention, privacy-by-design policy** outlined in its [Privacy Policy](https://wipeclip.co/privacy):

* **Ephemeral Media Storage:** Uploaded media files are stored exclusively in temporary scratch storage for the duration of the processing job and **deleted immediately upon rendering completion**.
* **Zero Model Training:** Customer video and audio files are never used to train machine learning models.
* **Cardholder Data Security:** WipeClip never captures, stores, or processes cardholder PANs, CVVs, or cardholder credentials. All financial data entry is isolated within the PCI-DSS Level 1 compliant hosted checkout of the payment gateway.
* **Transport Security:** All traffic is encrypted in transit using TLS 1.3 / SSL.

---

## 8. Customer Support, Refund Policy & Dispute Mitigation

To minimize chargeback and dispute rates, WipeClip provides crystal-clear consumer protection guarantees:

### 8.1 Transparent Refund Policy
As published in Section 6 of our Terms of Service:
* **14-Day Refund Window:** Full monetary refund is provided for paid purchases if the customer has consumed less than 20% of the purchased credit allocation and experienced technical difficulties.
* **Automatic System Credit Protection:** If a processing job fails due to a server or timeout error, the system automatically detects the error and credits the consumed balance back to the user account in real time.

### 8.2 Customer Service & Support SLAs
* **Customer Support Channel:** `support@wipeclip.co`
* **Response Time SLA:** Inquiries and refund requests are acknowledged and addressed within **24 to 48 business hours**.
* **Order History & Receipts:** Users can review their active credit transactions, orders, and receipts directly from their account dashboard.
* **Proactive Dispute Handling:** Customers are encouraged to contact support for instant refunds before escalating to bank dispute channels.

---

## 9. Technical Stack & Infrastructure Overview

* **Frontend:** Next.js 15 (React 19, TypeScript, Tailwind CSS), deployed on Vercel high-availability global edge CDN.
* **Backend Pipeline:** Python FastAPI, FFmpeg video processing framework, image-processing engines, hosted in isolated container environments.
* **Database & Auth:** Supabase (Enterprise PostgreSQL) with Row-Level Security (RLS) policies and encrypted session authentication.
* **Payment Integration:** Direct server-to-server webhook ingestion with HMAC-SHA256 signature verification and replay attack mitigation (5-minute timestamp tolerance window).

---

## 10. Summary Statement for Merchant Underwriting

WipeClip operates as a lawful, professional-grade digital utility service with:
* Clear utility value for digital video professionals and creators.
* Immediate digital fulfillment with zero inventory risk.
* Non-recurring, consent-driven billing structures minimizing chargeback exposure.
* Strict copyright and content moderation policies with a dedicated DMCA response process.
* Ephemeral data processing with zero retention of user files.

*Authorized on behalf of WipeClip.co Operations & Management.*
