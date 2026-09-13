// Content-curation / UGC / social-embed fingerprint rules. Detect content aggregation, user-
// generated-content galleries, and social-curation widgets from embed script domains and markers.
// Category "technology", severity "info". Signals route to wstg-info-gathering for third-party
// script inventory and client-side supply-chain surface mapping.
import type { DeclarativeRule } from "../declarative"

const cc = (id: string, name: string, pattern: string): DeclarativeRule => ({
  id,
  category: "technology",
  severity: "info",
  when: `regex("${pattern}", resp.body)`,
  message: `Content curation detected: ${name} at {endpoint}`,
  dedupBy: "host",
  tags: ["tech", "content-curation"],
})

export const contentCurationRules: DeclarativeRule[] = [
  cc("tech-cc-juicer", "juicer", "juicer\\.io|juicer-feed|assets\\.juicer\\.io"),
  cc("tech-cc-tagembed", "tagembed", "tagembed\\.com|widget\\.tagembed|tagembed-widget"),
  cc("tech-cc-covetpics", "covet-pics", "covet\\.pics|covetpics"),
  cc("tech-cc-ceros", "ceros", "view\\.ceros\\.com|ceros\\.com|ceros-experience|cerosassets"),
  cc("tech-cc-upcontent", "upcontent", "upcontent\\.com|upcontent-|app\\.upcontent"),
  cc("tech-cc-frase", "frase", "frase\\.io|frase\\.com|frase-widget"),
  cc("tech-cc-bazaarvoice", "bazaarvoice-curation", "bazaarvoice\\.com/curation|apps\\.bazaarvoice|bvapi|bv-curations"),
  cc("tech-cc-scoopit", "scoop-it", "scoop\\.it|scoopit"),
  cc("tech-cc-foursixty", "foursixty", "foursixty\\.com|foursixty"),
  cc("tech-cc-emplifi", "emplifi-ugc", "emplifi\\.io|emplifi-ugc|go\\.pixlee\\.com"),
  cc("tech-cc-madcap", "madcap-software", "madcapsoftware|madcap-|mcwebhelp|MadCap"),
  cc("tech-cc-nosto", "nosto-visual-ugc", "nosto\\.com|nostojs|nosto-visual-ugc"),
  cc("tech-cc-foleon", "foleon", "foleon\\.com|foleoncdn"),
  cc("tech-cc-letro", "letro", "letro\\.com|letro-ugc|letro\\.co"),
  cc("tech-cc-cevoid", "cevoid", "cevoid\\.com|cevoid-widget"),
  cc("tech-cc-snapsea", "snapsea", "snapsea\\.io|snapsea"),
  cc("tech-cc-storystream", "storystream", "storystream\\.ai|storystream"),
  cc("tech-cc-contentstudio", "contentstudio", "contentstudio\\.io|contentstudio"),
  cc("tech-cc-cpex", "cpex", "cpex\\.cz|cpex-widget"),
  cc("tech-cc-tagboard", "tagboard", "tagboard\\.com|tagboard"),
  cc("tech-cc-amondo", "amondo", "amondo\\.com|amondo-"),
  cc("tech-cc-olapic", "olapic", "olapic\\.com|photorankstatic|olapic-"),
  cc("tech-cc-miappi", "miappi", "miappi\\.com|miappi"),
  cc("tech-cc-natural-intelligence", "natural-intelligence", "naturalint\\.com|natural-intelligence"),
  cc("tech-cc-photoslurp", "photoslurp", "photoslurp\\.com|getphotoslurp|photoslurp"),
  cc("tech-cc-contentbot", "contentbot", "contentbot\\.ai|contentbot"),
  cc("tech-cc-sniply", "sniply", "snip\\.ly|sniply"),
  cc("tech-cc-ugc-creative", "ugc-creative", "ugc-creative|ugccreative"),
  cc("tech-cc-contently", "contently", "contently\\.com|contently-"),
  cc("tech-cc-epublishing", "epublishing", "epublishing\\.com|epublishing-"),
  cc("tech-cc-lineup", "line-up", "line-up\\.me|lineup\\.me"),
  cc("tech-cc-contribly", "contribly", "contribly\\.com|contribly"),
  cc("tech-cc-sverve", "sverve", "sverve\\.com|sverve"),
  cc("tech-cc-curated", "curated", "curated\\.co|curated-widget"),
  cc("tech-cc-contents", "contents", "contents\\.com/widget|contents-ai"),
  cc("tech-cc-klangoo", "klangoo", "klangoo\\.com|klangoo"),
  cc("tech-cc-rock-content", "rock-content", "rockcontent\\.com|rock-content"),
  cc("tech-cc-feedmagnet", "feedmagnet", "feedmagnet\\.com|feedmagnet"),
  cc("tech-cc-octipulse", "octipulse", "octipulse\\.com|octipulse"),
  cc("tech-cc-contentgems", "contentgems", "contentgems\\.com|contentgems"),
]
