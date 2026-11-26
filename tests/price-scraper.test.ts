import { describe, expect, it } from "vitest";
import {
  assertSafePublicUrl,
  extractProductInfoFromHtml,
  sumGiftItems,
  summarizeGiftOptions,
} from "@/lib/price-scraper";

describe("Web Scraper de Preços em R$ (4 Camadas + Sem Riscados)", () => {
  it("ignora preços riscados (<del>, line-through, old-price) e parcelas, pegando apenas o valor promocional R$", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Cafeteira Expresso Inox</title></head>
        <body>
          <h1>Cafeteira Expresso Inox</h1>
          <div class="pricing">
            <del>R$ 499,90</del>
            <span style="text-decoration: line-through;">R$ 459,00</span>
            <span class="old-price">De R$ 420,00</span>
            <div class="product-promo">Por R$ 289,90 no Pix</div>
            <p class="installment-info">ou em até 10x de R$ 28,99 sem juros</p>
          </div>
        </body>
      </html>
    `;

    const res = extractProductInfoFromHtml(
      html,
      "https://lojaexemplo.com.br/cafeteira-expresso"
    );
    expect(res.scrapedSuccessfully).toBe(true);
    expect(res.title).toBe("Cafeteira Expresso Inox");
    expect(res.price).toBe(289.9);
  });

  it("extrai corretamente estruturas reais estilo Amazon e Mercado Livre sem pegar o valor riscado", () => {
    const amazonHtml = `
      <html>
        <body>
          <h1>Fone Bluetooth ANC</h1>
          <span class="a-price" data-a-strike="true">
            <span class="a-offscreen">R$ 399,00</span>
          </span>
          <span class="a-price priceToPay">
            <span class="a-offscreen">R$ 219,80</span>
          </span>
        </body>
      </html>
    `;

    const amz = extractProductInfoFromHtml(
      amazonHtml,
      "https://www.amazon.com.br/dp/B000123"
    );
    expect(amz.scrapedSuccessfully).toBe(true);
    expect(amz.price).toBe(219.8);

    const mlHtml = `
      <html>
        <body>
          <h1>Tênis Esportivo Corrida</h1>
          <s class="andes-money-amount andes-money-amount--previous">
            <span class="andes-money-amount__fraction">349</span>
            <span class="andes-money-amount__cents">90</span>
          </s>
          <div class="ui-pdp-price__second-line">
            <span class="andes-money-amount">
              <span class="andes-money-amount__fraction">189</span>
              <span class="andes-money-amount__cents">50</span>
            </span>
          </div>
        </body>
      </html>
    `;

    const ml = extractProductInfoFromHtml(
      mlHtml,
      "https://produto.mercadolivre.com.br/MLB-12345"
    );
    expect(ml.scrapedSuccessfully).toBe(true);
    expect(ml.price).toBe(189.5);
  });

  it("extrai JSON-LD Schema.org Product e soma múltiplos links com precisão de centavos", () => {
    const jsonLdHtml = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Livro Clean Architecture",
              "offers": {
                "@type": "Offer",
                "priceCurrency": "BRL",
                "price": "74.90"
              }
            }
          </script>
        </head>
        <body></body>
      </html>
    `;

    const parsed = extractProductInfoFromHtml(
      jsonLdHtml,
      "https://livraria.com.br/clean-arch"
    );
    expect(parsed.scrapedSuccessfully).toBe(true);
    expect(parsed.title).toBe("Livro Clean Architecture");
    expect(parsed.price).toBe(74.9);

    const total = sumGiftItems([
      { price: 149.9 },
      { price: 89.95 },
      { price: 39.9 },
    ]);
    expect(total).toBe(279.75);

    // Verifica separação entre Opção 1 (não somada com Opção 2) vs combo na mesma opção
    const optSummary = summarizeGiftOptions([
      { price: 140, optionGroup: 1 },
      { price: 60, optionGroup: 2 },
      { price: 55, optionGroup: 2 },
    ]);
    expect(optSummary.isMultiOption).toBe(true);
    expect(optSummary.groups).toEqual([
      { optionGroup: 1, subtotal: 140, itemCount: 1 },
      { optionGroup: 2, subtotal: 115, itemCount: 2 },
    ]);
    expect(optSummary.maxOptionTotal).toBe(140);
  });

  it("bloqueia URLs locais ou IPs privados contra SSRF", () => {
    expect(() => assertSafePublicUrl("http://localhost:3000/admin")).toThrow();
    expect(() => assertSafePublicUrl("http://127.0.0.1:8080/test")).toThrow();
    expect(() => assertSafePublicUrl("http://192.168.0.10/router")).toThrow();
    expect(
      assertSafePublicUrl("https://www.magazineluiza.com.br/p/123").hostname
    ).toBe("www.magazineluiza.com.br");
  });
});
