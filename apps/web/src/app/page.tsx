// Copyright (c) 2026, Rademics. All rights reserved.
import type { Metadata } from "next";
import Link from "next/link";
import { SHOP_TYPE_KEYS, SHOP_TYPES, type ShopTypeKey } from "shared";
import { Icon, type IconName } from "@/components/icons";
import { ContactForm } from "@/components/landing/contact-form";
import { BrandMark } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Retail ERP — billing, stock, GST and accounts for your shop",
  description: "Billing counter, stock, GST invoices and accounts in one place, for Indian fancy, clothing, footwear, cosmetics and mobile shops. 14 days free.",
};

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "barcode", title: "A fast billing counter", text: "Scan, take cash, card or UPI, print the bill. Keeps billing when the internet drops and catches up later." },
  { icon: "box", title: "Stock that is always right", text: "Every sale, return and purchase moves the stock. Several shops, transfers between them, sizes and colours." },
  { icon: "receipt", title: "GST done properly", text: "Tax by place of supply, B2B invoices, credit notes, GSTR-1 and GSTR-3B figures, e-invoice and e-way bill files." },
  { icon: "book", title: "Accounts that keep themselves", text: "Every bill posts to the books by itself. Cash book, bank, supplier dues and a Tally export for your accountant." },
  { icon: "percent", title: "Offers, loyalty and gift cards", text: "Discounts, buy-one-get-one, coupons, points your customers earn and spend, and reloadable gift cards." },
  { icon: "chart", title: "Reports you will read", text: "Today's sales, best sellers, slow stock, profit and a short summary email every evening." },
];

const SHOP_ICONS: Record<ShopTypeKey, IconName> = { fancy: "tag", clothing: "ruler", footwear: "box", cosmetics: "clock", mobiles: "devices", general: "store" };

const STEPS = [
  { title: "Sign up", text: "Your name, email and shop name. Two minutes." },
  { title: "Tell us about your shop", text: "Business details, GST, your first shop and what you sell. We switch on what you need." },
  { title: "Start billing", text: "Add your items or import them from Excel, load your stock, and make your first bill." },
];

/** Plan 14: what a visitor sees at retailerp.52digit.com. */
export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-bar">
        <Link href="/" className="public-brand landing-brand">
          <BrandMark />
          Retail ERP
        </Link>
        <nav className="landing-nav" aria-label="Page">
          <a href="#features">What it does</a>
          <a href="#shops">Shops</a>
          <a href="#contact">Contact us</a>
        </nav>
        <div className="landing-bar-end">
          <Link href="/login" className="btn btn-link">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Start free trial
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-text">
            <p className="landing-kicker">For Indian shops</p>
            <h1>Billing, stock, GST and accounts. One place, built for your shop.</h1>
            <p className="landing-lead">Retail ERP runs your billing counter and keeps your stock, GST and books right as you sell. Made for fancy, clothing, footwear, cosmetics and mobile shops.</p>
            <div className="landing-cta">
              <Link href="/signup" className="btn btn-primary landing-cta-main">
                Start your 14-day free trial
              </Link>
              <a href="#contact" className="btn">
                Book a demo
              </a>
            </div>
            <p className="muted landing-note">No card needed. Your shop&apos;s data is seen only by your shop.</p>
          </div>
          <SampleBill />
        </section>

        <section id="features" className="landing-section">
          <h2>What it does</h2>
          <div className="landing-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-feature">
                <span className="landing-feature-icon" aria-hidden="true">
                  <Icon name={f.icon} size={20} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="shops" className="landing-section">
          <h2>Set up for your kind of shop</h2>
          <p className="landing-lead">Pick your kind of shop when you sign up. Retail ERP switches on what it needs and keeps the rest out of the way. Change it any time.</p>
          <ul className="landing-shops">
            {SHOP_TYPE_KEYS.map((k) => (
              <li key={k}>
                <Icon name={SHOP_ICONS[k]} size={18} />
                <span>
                  <strong>{SHOP_TYPES[k].label}</strong>
                  <span className="muted">{SHOP_TYPES[k].description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section">
          <h2>Start in three steps</h2>
          <ol className="landing-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="landing-step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-price">
          <h2>Free for 14 days</h2>
          <p className="landing-lead">Try everything with your own items and bills. After that, a simple monthly plan for your number of counters and shops: talk to us and we will suggest the right one.</p>
          <Link href="/signup" className="btn btn-primary">
            Start free trial
          </Link>
        </section>

        <section id="contact" className="landing-section landing-contact">
          <div>
            <h2>Contact us</h2>
            <p className="landing-lead">Want to see it first? Leave your number and we will call you to show Retail ERP with your kind of shop.</p>
          </div>
          <ContactForm />
        </section>
      </main>

      <footer className="landing-footer">
        <span>© 2026 Rademics. All rights reserved.</span>
        <span>
          <Link href="/login">Log in</Link> · <Link href="/signup">Start free trial</Link>
        </span>
      </footer>
    </div>
  );
}

/** A small bill drawn with the page's own styles: what the billing counter prints. */
function SampleBill() {
  const lines = [
    ["Gold-plated earrings", "1", "224.10"],
    ["Cotton T-shirt black M", "2", "798.00"],
  ];
  return (
    <figure className="landing-bill" aria-label="A sample bill from the billing counter">
      <div className="landing-bill-head">
        <strong>Sri Lakshmi Fancy</strong>
        <span>TAX INVOICE · MAT1/2627/000001</span>
      </div>
      <table>
        <tbody>
          {lines.map(([name, qty, amount]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="num">{qty}</td>
              <td className="num">₹{amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="landing-bill-row">
        <span>10% off fancy and gifts</span>
        <span>−₹24.90</span>
      </div>
      <div className="landing-bill-total">
        <span>Total</span>
        <span>₹1,022.00</span>
      </div>
      <div className="landing-bill-gst">
        <span>CGST + SGST 3%</span>
        <span>₹6.53</span>
        <span>CGST + SGST 5%</span>
        <span>₹38.00</span>
      </div>
      <figcaption>Paid by UPI · 10 loyalty points earned</figcaption>
    </figure>
  );
}
