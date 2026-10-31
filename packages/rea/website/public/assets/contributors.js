import { t } from "./i18n.js";

const search = document.querySelector("[data-contributors-search]");
const input = document.getElementById("contributor-search");
const status = document.querySelector("[data-contributors-status]");
const empty = document.querySelector("[data-contributors-empty]");
const people = Array.from(document.querySelectorAll("[data-contributor]"));

if (search && input && status && empty) {
  function filterContributors() {
    const query = input.value.trim().replace(/^@/, "").toLowerCase();
    let count = 0;
    for (const person of people) {
      const matches = person
        .getAttribute("data-contributor")
        .toLowerCase()
        .includes(query);
      person.hidden = !matches;
      if (matches) count += 1;
    }
    status.textContent = t("Contributors: {count}", {
      count: new Intl.NumberFormat(document.documentElement.lang).format(count),
    });
    empty.hidden = count !== 0;
  }

  input.addEventListener("input", filterContributors);
  input.addEventListener("search", filterContributors);
  filterContributors();
  search.hidden = false;
}
