# MCP product import guide

Importer-facing notes for catalog loads via online MCP (UAT / production API host).

## How to connect

Online MCP shares the API host (no separate subdomain):

| Environment | MCP URL                                                      |
| ----------- | ------------------------------------------------------------ |
| UAT         | `https://api-new-uat.sopet.org/mcp`                          |
| Production  | `https://api.sopet.org/mcp` (or current production API host) |

Authenticate with bearer `MCP_HTTP_TOKEN` (same secret configured on the backend).

Example Cursor config:

```json
{
  "mcpServers": {
    "sopet-admin": {
      "url": "https://api-new-uat.sopet.org/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_HTTP_TOKEN>"
      }
    }
  }
}
```

Admin session is established by the server from `MCP_ADMIN_EMAIL` / `MCP_ADMIN_PASSWORD`. For store-scoped tools, always pass explicit `storeId`.

Local package mirror (stdio): see `sopet-admin/mcp/README.md` in the admin repo. Keep tool selections in sync with this backend module — **online UAT MCP is the source of truth**.

## Recommended import sequence

For one store (admin session + `storeId`):

1. **Resolve taxonomy**
   - `admin_list_categories` / `admin_list_brands` / `admin_list_pet_types`
   - `admin_create_brand` (and category/pet-type create tools) when missing
2. **Create product** — `store_create_product` (draft until publish)
3. **Variants** — `store_sync_product_variants` (sku, stock, price, attributes JSON input; response uses `optionsJson`)
4. **Images** (optional) — `store_add_product_image` with a public `url`
5. **Shipping** — store shipping option tools when the store needs a default rate
6. **Publish when ready** — `store_get_publish_checklist` → `store_publish_product` / `store_publish_products`

After a create that previously returned HTTP 400, call `store_list_products` (search by SKU prefix / name) — GraphQL may have persisted the mutation before the invalid selection set failed.

## Working vs broken (current)

| Area                                           | Status                   | Notes                                                  |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------ |
| Admin stores list/get                          | Working                  | Field selection fixed earlier                          |
| Categories / tags / brands / pet types         | Working                  | List + create brand as needed                          |
| Notifications (array shape)                    | Working                  | Fixed earlier                                          |
| Product list / get / create / update / publish | Fixed in this change     | Was selecting `createdAt`/`updatedAt` on `ProductType` |
| Product variants sync                          | Fixed in this change     | Response must use `optionsJson`, not `attributes`      |
| Product images                                 | Fixed in this change     | Response must use `imageUrl`, not `url`/`altText`      |
| Store ops, orders, inventory, shipping setup   | Untested / use with care | Spot-check before bulk use                             |

## KKC import — open decisions

Policy checklist for the importer agent (not schema bugs):

| #   | Topic                     | Question                                                         |
| --- | ------------------------- | ---------------------------------------------------------------- |
| 1   | 12% Sopet fee             | List CSV prices as-is, or mark up?                               |
| 2   | Updated prices            | Prefer CSV “updated” price vs store list price for the 59 diffs? |
| 3   | Missing brands            | Auto-create ~187 brands on UAT?                                  |
| 4   | Pet type                  | Dual dog+cat / unknown: pick one, leave null, or skip?           |
| 5   | Stock / images / shipping | Default stock 0; skip images; create 25฿ shipping option?        |
| 6   | Typos / units             | Apply suggested fixes from the issue sheet?                      |
| 7   | Vet drugs                 | Import as draft + warning only, or hold for legal review?        |

### Defaults when policy is unset

- List CSV prices **as-is** (no fee markup)
- Use the **higher “updated” price** when present
- **Create** missing brands
- Leave **pet type null** when ambiguous (dual / unknown)
- **Stock 0**, **no images**
- Apply **typo / unit fixes** from the issue sheet
- Import vet rows as **draft** with a warning string; **do not publish**
