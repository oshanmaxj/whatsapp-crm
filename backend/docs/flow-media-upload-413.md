# Flow media upload 413 recovery

## Diagnosis

The application previously sent Flow Builder media as base64 JSON. Base64 expands a 16 MB video to about 21.3 MB before JSON/multipart overhead. The backend route itself used a 140 MB JSON parser, so an HTML `413 Request Entity Too Large` without API CORS headers could not have come from Express. It was generated before the request reached the application, by the effective Nginx HTTPS configuration or another upstream proxy.

The application now sends `multipart/form-data`, enforces a 20 MB Multer transport ceiling, applies the 5 MB image and 16 MB video WhatsApp limits in the application, and returns structured JSON errors. Nginx must still allow 25 MB in the server block that actually handles `api.firstofsolutions.com:443`.

Public DNS observed during implementation resolved `api.firstofsolutions.com` directly to `159.69.83.24`, with no CNAME and no Cloudflare edge address. The authoritative DNS provider uses Porkbun nameservers; that does not mean Cloudflare proxies the API. Recheck DNS during deployment because it can change.

## Locate the effective Nginx configuration

```bash
sudo nginx -T 2>&1 | sudo tee /tmp/nginx-effective.txt >/dev/null

sudo grep -nE 'configuration file|listen .*443|server_name .*api\.firstofsolutions\.com|location .*api|client_max_body_size|client_body_timeout' /tmp/nginx-effective.txt

sudo grep -RnsE 'server_name[[:space:]]+.*api\.firstofsolutions\.com|client_max_body_size|client_body_timeout' \
  /etc/nginx/nginx.conf /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d

sudo find -L /etc/nginx/sites-enabled -maxdepth 1 -type f -printf '%p -> %l\n'
for file in /etc/nginx/sites-enabled/*; do sudo readlink -f "$file"; done
```

`nginx -T` is authoritative. A file in `sites-available` has no effect unless `nginx.conf` includes it directly or it is linked/included through an active path. Inspect every duplicate `server_name api.firstofsolutions.com` block and confirm which one has `listen 443 ssl` and the certificate used by the live hostname.

Useful live checks:

```bash
dig +short CNAME api.firstofsolutions.com
dig +short A api.firstofsolutions.com
curl -vkI https://api.firstofsolutions.com/api/health 2>&1 | grep -Ei 'connected to|server:|via:|cf-ray|x-cache'
```

Cloudflare-proxied DNS normally returns Cloudflare edge addresses and responses commonly include `server: cloudflare`/`cf-ray`. If a CDN or load balancer is discovered, its request limit must also exceed 20 MB. Cloudflare's plan-specific limits should be checked in the active Cloudflare dashboard rather than inferred from DNS documentation.

## Patch the active HTTPS server

Use `sudoedit` on the exact file reported by `nginx -T`. Do not edit an inactive copy in `sites-available`.

```nginx
server {
    listen 443 ssl http2;
    server_name api.firstofsolutions.com;

    client_max_body_size 25M;
    client_body_timeout 120s;

    error_page 413 = @flow_upload_413;

    location /api/ {
        client_max_body_size 25M;
        client_body_timeout 120s;
        proxy_request_buffering off;

        # Keep the existing proxy_pass and proxy headers here.
    }

    location @flow_upload_413 {
        default_type application/json;
        add_header Access-Control-Allow-Origin "https://crm.firstofsolutions.com" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Vary "Origin" always;
        return 413 '{"error":"NGINX_REQUEST_TOO_LARGE","message":"Upload exceeds the 25 MB proxy limit.","rejectedLayer":"nginx"}';
    }
}
```

Remove or raise any smaller `client_max_body_size` inside the matching `/api`, `/api/flows`, or regex location. A location-level value overrides the server-level value.

Validate, reload, and re-read the effective configuration:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager

sudo nginx -T 2>&1 | sudo tee /tmp/nginx-effective-after.txt >/dev/null
sudo grep -nE 'server_name .*api\.firstofsolutions\.com|client_max_body_size|client_body_timeout|flow_upload_413' /tmp/nginx-effective-after.txt
```

## Verify the application and upload boundary

The diagnostics endpoint requires an authorized flow-builder token and does not accept file data:

```bash
read -rsp 'CRM access token: ' CRM_ACCESS_TOKEN
echo

curl -fsS \
  -H "Authorization: Bearer $CRM_ACCESS_TOKEN" \
  https://api.firstofsolutions.com/api/flows/22/media/diagnostics
```

Expected values include `multipart/form-data`, `backendTransportLimitBytes: 20971520`, `expectedProxyLimit: 25M`, and `expectedBodyTimeout: 120s`.

Test a genuine supported sample smaller than its WhatsApp limit. This performs a real Meta upload using flow 22's selected account:

```bash
curl -i --max-time 120 \
  -H "Authorization: Bearer $CRM_ACCESS_TOKEN" \
  -F 'whatsappAccountId=<CRM_WHATSAPP_ACCOUNT_ID>' \
  -F 'mediaType=video' \
  -F 'file=@/absolute/path/sample-h264-aac.mp4;type=video/mp4' \
  https://api.firstofsolutions.com/api/flows/22/media
```

Verify the backend/Multer rejection layer with a disposable 21 MB request. It must return JSON rather than an Nginx HTML page:

```bash
dd if=/dev/zero of=/tmp/flow-upload-21m.mp4 bs=1M count=21 status=none
curl -i --max-time 120 \
  -H "Authorization: Bearer $CRM_ACCESS_TOKEN" \
  -F 'mediaType=video' \
  -F 'file=@/tmp/flow-upload-21m.mp4;type=video/mp4' \
  https://api.firstofsolutions.com/api/flows/22/media
```

Expected response: HTTP 413 with `error: FILE_TOO_LARGE` and `rejectedLayer: multer`. If the response is still Nginx HTML, the 25 MB directive is not effective on the live request path or another proxy has a smaller limit.

Inspect both layers without logging credentials or file content:

```bash
sudo grep 'POST /api/flows/22/media' /var/log/nginx/access.log | tail -20
pm2 logs whatsapp_crm_backend --lines 200 --nostream | grep 'flow_media_upload_'
```

An Nginx access entry with status 413 and no `flow_media_upload_received` backend log proves rejection occurred before Express.
