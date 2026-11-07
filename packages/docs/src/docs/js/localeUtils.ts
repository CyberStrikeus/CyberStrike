import { defaultLocale, locales } from "@/docs/config/siteSettings.json";

/**
 * * returns the current locale gathered from the URL
 * @param url: current URL
 * @returns current locale as a string
 * use like `const currentLocale = getLocaleFromUrl(Astro.url);`
 *
 * This gives you the same result as `Astro.currentLocale` except:
 * - it never returns "undefined", and instead defaults to the defaultLocale
 * - It is useable in this typescript file and other non-astro files
 */
export function getLocaleFromUrl(url: URL): (typeof locales)[number] {
  const [, locale] = url.pathname.split("/");

  //@ts-ignore
  if (locales.includes(locale)) return locale as (typeof locales)[number];
  return defaultLocale;
}

/**
 * * return a content collection (such as blog posts) array filtered by language
 * @param collection: content collection array
 * @param locale: language to filter by (one of the above locales)
 * @param removeLocale: boolean (optional, default TRUE) - remove the locale from the slug field
 * @returns filtered content collection array
 *
 *  ## Example
 *
 * ```ts
 *  import { getAllPosts } from "@/docs/js/blogUtils";
 *  import { filterCollectionByLanguage } from "@/docs/js/i18nUtils";
 *  const posts = await getAllPosts();
 *  const filteredPosts = filterCollectionByLanguage(posts, "de");
 * ```
 *
 * ## How to setup content collection
 *
 * Your content collections should be paths like `src/data/blog/de/my-post.md` and `src/data/blog/en/my-post.md`
 */
export function filterCollectionByLanguage(
  collection: any[],
  locale: (typeof locales)[number],
  removeLocale: boolean = true,
): any[] {
  // check if the passed language is in the languages array
  if (!locales.includes(locale)) {
    console.error(`Language ${locale} not found in locales array`);
    return [];
  }

  const filteredCollection = collection.filter((item) => item.id.startsWith(`${locale}/`));

  // remove locale from URL
  if (removeLocale) {
    filteredCollection.forEach((item) => {
      // @ts-ignore (it's fine, we're just removing the locale from the URL)
      item.id = removeLocaleFromSlug(item.id);
    });
  }

  // filter the collection by the passed language
  return filteredCollection;
}

/**
 * * removes any instances of the locale from the URL
 * @param slug: string URL to remove locale from
 * @returns string URL with locale removed
 * Useful for content colection subfolders like blog/en/my-post where the slug field will be "en/my-post"
 */
export function removeLocaleFromSlug(slug: string): string {
  // split the URL into parts separated by "/"
  const SlugElements = slug.split("/");

  // map over the URL parts and remove any locales
  const newSlugElements = SlugElements.filter(
    //@ts-ignore
    (element) => !locales.includes(element),
  );

  // combine the URL parts back into a string
  return newSlugElements.join("/");
}
