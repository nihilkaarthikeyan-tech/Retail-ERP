// Copyright (c) 2026, Rademics. All rights reserved.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SHOP_TYPE_KEYS, SHOP_TYPES } from "shared";
import { BrandMark } from "@/components/brand-mark";
import { Icon, type IconName } from "@/components/icons";
import { ContactForm } from "@/components/landing/contact-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Retail ERP — GST billing and stock for your shop",
  description: "Billing counter, stock, GST and accounts in one place, for Indian fancy, clothing, footwear, cosmetics, mobile and general stores. 14 days free.",
};

interface Feature {
  icon?: IconName;
  title: string;
  text: string;
}

const BILLING: Feature[] = [
  { icon: "barcode", title: "Scan or search", text: "Any barcode scanner works. No barcode? Find the item by name or code." },
  { icon: "rupee", title: "Cash, card and UPI in one bill", text: "Split a bill any way the customer pays. Every rupee lands in the right place." },
  { icon: "refresh", title: "Returns and exchanges", text: "Take goods back against the bill. Stock, GST and cash correct themselves." },
  { icon: "alert", title: "Keeps billing when the internet drops", text: "Bills wait on the counter computer and go up once you are back online, each one once." },
  { icon: "file", title: "Hold a bill", text: "Park a half-done bill while a customer keeps shopping, and serve the next one." },
  { icon: "clock", title: "Shift close with cash count", text: "Count the drawer at day end and see straight away if anything is short." },
];

const STOCK: Feature[] = [
  { icon: "ruler", title: "Sizes and colours", text: "One shirt, every size and colour, with stock for each." },
  { icon: "calendar", title: "Batches and expiry", text: "For cosmetics: see what expires soon and sell the oldest first." },
  { icon: "devices", title: "IMEI and serial numbers", text: "For mobiles: every handset tracked from purchase to sale." },
  { icon: "transfer", title: "Move stock between shops", text: "Send goods to a branch and see them in transit until they arrive." },
  { icon: "chart", title: "Reorder before you run out", text: "Set a level per item and get a list of what to buy and from whom." },
  { icon: "tag", title: "Price tags and barcode labels", text: "Print labels for new stock straight after the goods are received." },
];

const GST: Feature[] = [
  { title: "CGST, SGST and IGST on each line", text: "Same state or another state, the right tax with HSN on every bill." },
  { title: "GSTR-1 ready for the portal", text: "Download the file the GST portal accepts, plus the Excel your accountant wants." },
  { title: "E-invoice and e-way bill files", text: "Make the files for the government portals and keep the numbers on the bill." },
  { title: "Input credit matching", text: "Match your supplier bills against GSTR-2B and see what is missing." },
  { title: "Books that always balance", text: "A saved bill is never changed. A mistake is cancelled on record, so the books stay clean." },
  { title: "Tally export", text: "Send vouchers and ledgers to Tally if your accountant works there." },
];

const HARDWARE = [
  { label: "Counter", text: "Any computer with a browser" },
  { label: "Scanner", text: "USB barcode scanners" },
  { label: "Printer", text: "Thermal receipt printers, through the Till Helper for Windows" },
  { label: "Labels", text: "Label rolls or A4 sticker sheets" },
];

const DATA = [
  { title: "Download it any time", text: "The Owner takes a full copy of every list and record in one click." },
  { title: "Kept apart from other shops", text: "The database itself shows each shop only its own records." },
  { title: "Backed up every night", text: "A copy of everything is saved each night, away from the live system." },
  { title: "Every change on record", text: "Who changed a price or cancelled a bill, and when, is always in the history." },
];

const STEPS = [
  { title: "Sign up", text: "Your name, email and shop name. Takes two minutes." },
  { title: "Answer a few questions", text: "Shop type, GSTIN and address. The settings fill in for you." },
  { title: "Bring your items", text: "Upload your item list from Excel, with prices and opening stock." },
  { title: "Make your first bill", text: "Try it with test bills, then clear them and go live." },
];

const QUESTIONS = [
  { q: "Does billing stop if the internet goes down?", a: "No. The billing counter keeps saving bills on the counter computer and sends them once the connection is back. Each bill is sent only once, even if it is tried twice." },
  { q: "Can I use it for more than one shop?", a: "Yes. Add every branch as a shop, move stock between them, and see all their sales from one login." },
  { q: "Will it work with my barcode scanner and printer?", a: "A USB barcode scanner works straight away. Receipt printers and cash drawers connect through the small Till Helper program on the counter computer." },
  { q: "Can my accountant still use Tally?", a: "Yes. Export vouchers and ledgers for Tally, and give your accountant the GST files and Excel reports." },
  { q: "Can staff see only what they need?", a: "Yes. Each person gets a role, such as cashier, store manager or accountant, and sees only the screens and shops that role allows." },
];

/** A product picture in the light and dark versions; the page's theme picks which one shows. */
function Shot({ name, alt }: { name: string; alt: string }) {
  return (
    <>
      <Image className="lp-shot only-light" src={`/landing/${name}-light.png`} alt={alt} width={2160} height={1290} priority={name === "dashboard"} />
      <Image className="lp-shot only-dark" src={`/landing/${name}-dark.png`} alt={alt} width={2160} height={1290} />
    </>
  );
}

function FeatureGrid({ items }: { items: Feature[] }) {
  return (
    <div className="lp-grid">
      {items.map((f) => (
        <div key={f.title} className="lp-cell">
          {f.icon ? <Icon name={f.icon} size={22} /> : null}
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </div>
      ))}
    </div>
  );
}

/** Plan 14, F look (owner, 23 October 2026): what a visitor sees at retailerp.52digit.com. */
export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-bar">
        <div className="lp-wrap lp-bar-row">
          <Link href="/" className="lp-brand">
            <BrandMark />
            Retail ERP
          </Link>
          <nav className="lp-nav" aria-label="Page">
            <a href="#billing">Features</a>
            <a href="#shops">Shop types</a>
            <a href="#hardware">Hardware</a>
            <a href="#pricing">Pricing</a>
            <a href="#contact">Talk to us</a>
          </nav>
          <div className="lp-bar-end">
            <Link href="/login" className="btn btn-small">
              Log in
            </Link>
            <Link href="/signup" className="btn btn-small btn-primary">
              Start free trial
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <section id="top" className="lp-wrap lp-hero">
          <p className="label-mono">For Indian shops</p>
          <h1>GST billing and stock for your shop, in one place</h1>
          <p className="lp-lead">Bill at the counter, keep every shelf counted and get your GST figures ready, for one shop or many. Made for fancy, clothing, footwear, cosmetics, mobile and general stores.</p>
          <div className="lp-cta">
            <Link href="/signup" className="btn btn-primary lp-btn-lg">
              Start your 14-day free trial
            </Link>
            <a href="#contact" className="btn lp-btn-lg">
              Book a demo
            </a>
          </div>
          <p className="lp-note">No card needed to start.</p>
        </section>

        <div className="lp-wrap">
          <div className="lp-panel lp-panel-a">
            <Shot name="dashboard" alt="The Retail ERP dashboard for a sample shop: today's sales, bills, payments and what needs attention" />
          </div>
        </div>

        <nav className="lp-wrap lp-jump" aria-label="Explore">
          <span>Explore Retail ERP</span>
          <div>
            <a href="#billing" className="label-mono">Billing ↓</a>
            <a href="#stock" className="label-mono">Stock ↓</a>
            <a href="#gst" className="label-mono">GST and accounts ↓</a>
            <a href="#start" className="label-mono">Getting started ↓</a>
          </div>
        </nav>

        <section id="billing" className="lp-wrap lp-section">
          <div className="lp-split">
            <div>
              <h2>Bill every customer in seconds</h2>
              <p className="lp-lead">Scan, take cash, card or UPI in the same bill and print. Big buttons and keyboard keys for a busy counter.</p>
            </div>
            <div className="lp-panel lp-panel-b">
              <Shot name="billing" alt="The billing counter with items, GST, the amount to pay and payment buttons" />
            </div>
          </div>
          <FeatureGrid items={BILLING} />
        </section>

        <section id="stock" className="lp-wrap lp-section">
          <div className="lp-split lp-split-flip">
            <div className="lp-panel lp-panel-c">
              <Shot name="items" alt="The items list with codes, sizes and colours, prices and stock" />
            </div>
            <div>
              <h2>Know what is on every shelf</h2>
              <p className="lp-lead">Every piece that comes in or goes out is recorded, so the stock on screen matches the stock in the shop.</p>
            </div>
          </div>
          <FeatureGrid items={STOCK} />
        </section>

        <section id="gst" className="lp-wrap lp-section">
          <h2>GST and accounts, done as you bill</h2>
          <p className="lp-lead">Tax is worked out on every line from your registration and rates. Every bill, purchase and payment is posted to your books on the same save.</p>
          <FeatureGrid items={GST} />
        </section>

        <section id="hardware" className="lp-wrap lp-section">
          <div className="lp-split">
            <div>
              <h2>Use the counter you already have</h2>
              <p className="lp-lead">Retail ERP runs in the browser. A small helper on the counter computer talks to the receipt printer and cash drawer.</p>
            </div>
            <div className="lp-hw">
              {HARDWARE.map((h) => (
                <div key={h.label}>
                  <span className="label-mono">{h.label}</span>
                  <strong>{h.text}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="shops" className="lp-wrap lp-section">
          <h2>Set up for your kind of shop</h2>
          <p className="lp-lead">Pick your shop type when you sign up. Only the parts you need are switched on, and you can change it any time.</p>
          <ul className="lp-shops">
            {SHOP_TYPE_KEYS.map((k) => (
              <li key={k}>
                <strong>{SHOP_TYPES[k].label}</strong>
                <span>{SHOP_TYPES[k].description}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-wrap lp-section">
          <div className="lp-dark">
            <div>
              <p className="label-mono">Your data</p>
              <h2>Your shop’s data stays yours</h2>
            </div>
            <div className="lp-dark-grid">
              {DATA.map((d) => (
                <div key={d.title}>
                  <h3>{d.title}</h3>
                  <p>{d.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="start" className="lp-wrap lp-section">
          <h2>Start billing this week</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="label-mono">Step {i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="pricing" className="lp-wrap lp-section">
          <div className="lp-price">
            <div>
              <p className="label-mono">Pricing</p>
              <h2>Free for 14 days</h2>
              <p className="lp-lead">Use everything with your real items and staff. After the trial, the price depends on how many counters and shops you run. Talk to us and we will tell you plainly.</p>
            </div>
            <div className="lp-price-actions">
              <Link href="/signup" className="btn btn-primary lp-btn-lg">
                Start your free trial
              </Link>
              <a href="#contact" className="btn lp-btn-lg">
                Ask for the price
              </a>
            </div>
          </div>
        </section>

        <section id="faq" className="lp-wrap lp-section">
          <h2>Questions shop owners ask</h2>
          <div className="lp-faq">
            {QUESTIONS.map((x) => (
              <details key={x.q}>
                <summary>
                  {x.q}
                  <span className="lp-plus" aria-hidden="true" />
                </summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="contact" className="lp-wrap lp-section lp-contact">
          <div>
            <h2>Try it in your shop</h2>
            <p className="lp-lead">Start free today, or leave your number and we will call you to show Retail ERP with your kind of shop.</p>
            <div className="lp-cta">
              <Link href="/signup" className="btn btn-primary lp-btn-lg">
                Start your free trial
              </Link>
            </div>
          </div>
          <ContactForm />
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div>
            <Link href="/" className="lp-brand">
              <BrandMark />
              Retail ERP
            </Link>
            <p>Billing, stock, GST and accounts for Indian shops. Built and run by Rademics.</p>
          </div>
          <div>
            <p className="label-mono">Product</p>
            <a href="#billing">Billing</a>
            <a href="#stock">Stock</a>
            <a href="#gst">GST and accounts</a>
            <a href="#hardware">Hardware</a>
          </div>
          <div>
            <p className="label-mono">Shops</p>
            <a href="#shops">Clothing and footwear</a>
            <a href="#shops">Cosmetics</a>
            <a href="#shops">Mobiles</a>
            <a href="#shops">Fancy and general</a>
          </div>
          <div>
            <p className="label-mono">Company</p>
            <a href="#contact">Talk to us</a>
            <a href="#pricing">Pricing</a>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Start free trial</Link>
          </div>
        </div>
        <div className="lp-wrap lp-copy">© 2026 Rademics. All rights reserved.</div>
      </footer>
    </div>
  );
}
