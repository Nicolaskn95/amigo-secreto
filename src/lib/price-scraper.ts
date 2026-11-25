import * as cheerio from "cheerio";
import { AppError } from "./auth";

export interface ScrapedProductResult {
  url: string;
  title: string;
  price: number | null;
  scrapedSuccessfully: boolean;
  source?: "json-ld" | "meta" | "dom-selector" | "dom-brl-regex";
  warning?: string;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumGiftItems(items: Array<{ price: number }>): number {
  const total = items.reduce((acc, item) => {
    const val = Number(item.price);
    return acc + (Number.isFinite(val) && val > 0 ? val : 0);
  }, 0);
  return roundCurrency(total);
}

/**
 * Converte strings monetárias brasileiras ("R$ 1.299,90", "89,90") ou decimais ("129.90") em número.
 */
export function parseBRLPrice(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 && raw <= 1_000_000
      ? roundCurrency(raw)
      : null;
  }

  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\u00a0/g, " ").trim();
  if (!cleaned) return null;

  // Caso 1: Formato decimal internacional puro vindo de JSON-LD / Meta tags (ex: "149.90" ou "1299.9")
  if (/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    const num = Number(cleaned);
    return num > 0 && num <= 1_000_000 ? roundCurrency(num) : null;
  }

  // Caso 2: Extrai padrão brasileiro com vírgula decimal (ex: "R$ 1.299,90" ou "89,90")
  const brMatch = cleaned.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{1,2})/);
  if (brMatch) {
    const normalized = brMatch[1].replace(/\./g, "").replace(",", ".");
    const num = Number(normalized);
    return Number.isFinite(num) && num > 0 && num <= 1_000_000
      ? roundCurrency(num)
      : null;
  }

  // Caso 3: Inteiro precedido por R$ sem centavos (ex: "R$ 150")
  const intMatch = cleaned.match(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)/i);
  if (intMatch) {
    const normalized = intMatch[1].replace(/\./g, "");
    const num = Number(normalized);
    return Number.isFinite(num) && num > 0 && num <= 1_000_000
      ? roundCurrency(num)
      : null;
  }

  return null;
}

/**
 * Valida URL pública HTTP/HTTPS bloqueando endereços internos/privados (proteção anti-SSRF).
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new AppError("Informe um link válido começando com https://", 400, "INVALID_URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("O link precisa começar com http:// ou https://", 400, "INVALID_PROTOCOL");
  }

  const host = parsed.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new AppError("Links locais ou de rede privada não são permitidos.", 400, "UNSAFE_URL");
  }

  return parsed;
}

export function fallbackTitleFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const segments = u.pathname
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 2 && !/^(dp|p|produto|item|MLB-?\d+)$/i.test(s));

    if (segments.length > 0) {
      const slug = decodeURIComponent(segments[0])
        .replace(/[-_]+/g, " ")
        .replace(/\.html?$/i, "")
        .trim();
      if (slug.length >= 3) {
        return slug.charAt(0).toUpperCase() + slug.slice(1, 90);
      }
    }
    return `Produto (${u.hostname.replace(/^www\./, "")})`;
  } catch {
    return "Presente com link";
  }
}

function extractFromJsonLdNode(
  node: unknown
): { title?: string; price?: number } | null {
  if (!node || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = extractFromJsonLdNode(item);
      if (found?.price) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj["@graph"])) {
    const graphFound = extractFromJsonLdNode(obj["@graph"]);
    if (graphFound?.price) return graphFound;
  }

  const rawType = obj["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isProduct = types.some(
    (t) =>
      typeof t === "string" &&
      /^(Product|ProductGroup|IndividualProduct)$/i.test(t)
  );

  if (isProduct) {
    const title = typeof obj.name === "string" ? obj.name.trim() : undefined;
    const price = extractOfferPrice(obj.offers);
    if (price !== null) {
      return { title, price };
    }
    if (obj.hasVariant) {
      const variantFound = extractFromJsonLdNode(obj.hasVariant);
      if (variantFound?.price) {
        return {
          title: variantFound.title || title,
          price: variantFound.price,
        };
      }
    }
  }

  if (obj.mainEntity) {
    return extractFromJsonLdNode(obj.mainEntity);
  }

  return null;
}

function extractOfferPrice(offers: unknown): number | null {
  if (!offers) return null;

  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const p = extractOfferPrice(offer);
      if (p !== null) return p;
    }
    return null;
  }

  if (typeof offers !== "object") return null;
  const offerObj = offers as Record<string, unknown>;

  // Ignora especificações marcadas como StrikethroughPrice / ListPrice (preço riscado!)
  const priceType = String(offerObj.priceType || "");
  if (/Strikethrough|ListPrice/i.test(priceType)) {
    return null;
  }

  // Prioriza price (preço de venda atual) e lowPrice (menor preço promocional/à vista)
  const direct =
    parseBRLPrice(offerObj.price) ?? parseBRLPrice(offerObj.lowPrice);
  if (direct !== null) return direct;

  if (offerObj.priceSpecification) {
    const specPrice = extractOfferPrice(offerObj.priceSpecification);
    if (specPrice !== null) return specPrice;
  }

  if (offerObj.offers) {
    return extractOfferPrice(offerObj.offers);
  }

  return null;
}

/**
 * Extrai título e preço vigente (não riscado) de um documento HTML em 4 camadas.
 */
export function extractProductInfoFromHtml(
  html: string,
  url: string
): ScrapedProductResult {
  const $ = cheerio.load(html);

  let detectedTitle =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="twitter:title"]').attr("content")?.trim() ||
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $("title").first().text().replace(/\s+/g, " ").trim() ||
    "";

  // Camada 1: JSON-LD Schema.org (Product -> Offer.price / lowPrice)
  const jsonLdScripts = $('script[type="application/ld+json"]').toArray();
  for (const el of jsonLdScripts) {
    const rawJson = $(el).contents().text().trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const found = extractFromJsonLdNode(parsed);
      if (found?.title && !detectedTitle) {
        detectedTitle = found.title;
      }
      if (found?.price) {
        return {
          url,
          title: (found.title || detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
          price: found.price,
          scrapedSuccessfully: true,
          source: "json-ld",
        };
      }
    } catch {
      // ignora blocos JSON-LD malformados
    }
  }

  // Camada 2: Meta tags de produto (OpenGraph / Microdata)
  const metaSelectors = [
    'meta[property="product:sale_price:amount"]',
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
    '[itemprop="offers"] [itemprop="price"][content]',
  ];

  for (const sel of metaSelectors) {
    const contentVal = $(sel).first().attr("content");
    const parsedPrice = parseBRLPrice(contentVal);
    if (parsedPrice !== null) {
      return {
        url,
        title: (detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
        price: parsedPrice,
        scrapedSuccessfully: true,
        source: "meta",
      };
    }
  }

  // Camada 3: DOM limpo — remove TODOS os elementos riscados, preços antigos, parcelas e fretes
  $(
    "script, style, noscript, svg, template, header, footer, nav, aside, s, strike, del"
  ).remove();
  $('[data-a-strike="true"]').remove();
  $(".andes-money-amount--previous, .ui-pdp-price__original-value").remove();

  $("*").each((_idx, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;

    const inlineStyle = attribs.style || "";
    if (/line-through/i.test(inlineStyle)) {
      $(el).remove();
      return;
    }

    const combinedTokens = `${attribs.class || ""} ${attribs.id || ""} ${
      attribs["data-testid"] || ""
    }`;
    if (
      /(^|[\s_-])(strike|strikethrough|line-through|linethrough|old-?price|price-?old|list-?price|original-?price|was-?price|regular-?price|from-?price|preco-?de|preco-?antigo|installment|installments|parcela|parcelas|parcelamento|shipping|frete|you-?save|economize|related-products)([\s_-]|$)/i.test(
        combinedTokens
      )
    ) {
      $(el).remove();
    }
  });

  // Suporte especial ao formato fracionado do Mercado Livre (.andes-money-amount) já sem o riscado
  const mlMoney = $(
    ".ui-pdp-price__second-line .andes-money-amount, .ui-pdp-price__main-container .andes-money-amount"
  ).first();
  if (mlMoney.length > 0) {
    const fraction = mlMoney
      .find(".andes-money-amount__fraction")
      .first()
      .text()
      .trim();
    const cents =
      mlMoney.find(".andes-money-amount__cents").first().text().trim() || "00";
    if (fraction) {
      const mlPrice = parseBRLPrice(`${fraction},${cents}`);
      if (mlPrice !== null) {
        return {
          url,
          title: (detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
          price: mlPrice,
          scrapedSuccessfully: true,
          source: "dom-selector",
        };
      }
    }
  }

  // Seletores prioritários de preço promocional/atual em lojas brasileiras (Amazon, Magalu, Kabum, VTEX, Shopify)
  const activePriceSelectors = [
    ".priceToPay .a-offscreen",
    ".apexPriceToPay .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
    "#corePrice_feature_div .a-price .a-offscreen",
    '[data-testid="price-value"]',
    '[data-testid="product-price-value"]',
    '[class*="finalPrice"]',
    '[class*="spotPrice"]',
    '[class*="spot-price"]',
    '[class*="sale-price"]',
    '[class*="salePrice"]',
    '[class*="selling-price"]',
    '[class*="sellingPrice"]',
    '[class*="best-price"]',
    '[class*="bestPrice"]',
    '[class*="current-price"]',
    '[class*="currentPrice"]',
    '[itemprop="price"]',
  ];

  for (const sel of activePriceSelectors) {
    const nodes = $(sel).toArray();
    for (const node of nodes) {
      const text = $(node).text().replace(/\s+/g, " ").trim();
      const parsed = parseBRLPrice(text);
      if (parsed !== null) {
        return {
          url,
          title: (detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
          price: parsed,
          scrapedSuccessfully: true,
          source: "dom-selector",
        };
      }
    }
  }

  // Varredura geral no texto limpo (sem nós riscados!) procurando "R$ XX,XX" que não seja parcela nem desconto
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const brlRegex = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/gi;
  let match: RegExpExecArray | null;

  while ((match = brlRegex.exec(bodyText)) !== null) {
    const startIdx = match.index;
    const prefixContext = bodyText
      .slice(Math.max(0, startIdx - 35), startIdx)
      .toLowerCase();

    // Ignora valores de parcelamento ("10x de R$ 19,90"), frete ou desconto ("economize R$ 20,00")
    if (
      /(\d+\s*x\s*(de\s*)?|em\s+at[eé]\s*|parcela\w*\s*|frete\s*|entrega\s*|economize\s*|desconto\s*(de\s*)?|off\s*)$/i.test(
        prefixContext.trimEnd() + " "
      ) ||
      /\d+\s*x\s*(de)?$/i.test(prefixContext.trim())
    ) {
      continue;
    }

    const parsed = parseBRLPrice(match[0]);
    if (parsed !== null) {
      return {
        url,
        title: (detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
        price: parsed,
        scrapedSuccessfully: true,
        source: "dom-brl-regex",
      };
    }
  }

  return {
    url,
    title: (detectedTitle || fallbackTitleFromUrl(url)).slice(0, 140),
    price: null,
    scrapedSuccessfully: false,
    warning:
      "Não foi possível detectar o preço automaticamente nesta loja. Digite ou ajuste o valor manualmente.",
  };
}

/**
 * Busca a página do produto na web com timeout seguro e extrai título + valor em R$.
 */
export async function scrapeProductUrl(
  rawUrl: string
): Promise<ScrapedProductResult> {
  const parsedUrl = assertSafePublicUrl(rawUrl);
  const normalizedUrl = parsedUrl.toString();

  try {
    const response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      return {
        url: normalizedUrl,
        title: fallbackTitleFromUrl(normalizedUrl),
        price: null,
        scrapedSuccessfully: false,
        warning: `A loja bloqueou a leitura automática (HTTP ${response.status}). Preencha o valor manualmente.`,
      };
    }

    const html = await response.text();
    return extractProductInfoFromHtml(html, normalizedUrl);
  } catch {
    return {
      url: normalizedUrl,
      title: fallbackTitleFromUrl(normalizedUrl),
      price: null,
      scrapedSuccessfully: false,
      warning:
        "Tempo esgotado ou bloqueio da loja ao ler o link. Informe o valor manualmente.",
    };
  }
}
