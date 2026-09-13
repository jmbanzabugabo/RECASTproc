# Deploying CASTmir on AWS

Two things run: the **server** (API + dashboards + extension download) and the **extension**,
which users install from the server's home page. Deploy the server, then everyone downloads
the extension from your deployed URL — the download has that URL baked in, so there is
nothing for users to configure.

---

## 1. Durable storage first (5 minutes)

App Runner containers have an ephemeral filesystem: without this step, every redeploy or
scale event wipes captured data. Create a bucket and point CASTmir at it.

    aws s3 mb s3://castmir-data-<your-suffix> --region us-east-1

Block public access (default) and keep default encryption on. CASTmir writes a single object,
`castmir/castmir.json`, debounced to about one write per 1.5 s of activity.

---

## 2. App Runner from GitHub (recommended)

1. **App Runner → Create service → Source: Source code repository.**
2. Connect GitHub, pick `jmbanzabugabo/RECASTproc`, branch `main`, deployment trigger
   **Automatic**.
3. **Configure build → Use a configuration file**, and set **Source directory** to `system`.
   That is where `apprunner.yaml` and `package.json` live.
4. **Service settings**
   - Port: `8080`
   - Environment variables:
     | Name | Value |
     | --- | --- |
     | `CASTMIR_S3_BUCKET` | `castmir-data-<your-suffix>` |
     | `CASTMIR_S3_KEY` | `castmir/castmir.json` (optional) |
     | `CASTMIR_ADMIN_KEY` | a long random string |
   - Health check: **HTTP**, path `/v1/health`
   - Instance: 1 vCPU / 2 GB is ample for a pilot
5. **Instance role** — create an IAM role for the service with this policy, so it can read and
   write its own object:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::castmir-data-<your-suffix>/castmir/*"
  }]
}
```

6. Create the service. First deploy takes 3–5 minutes. App Runner gives you a URL like
   `https://xxxxx.us-east-1.awsapprunner.com`.
7. Open it. The home page is the install page; `/v1/health` should return `{"ok":true}`.

Every push to `main` redeploys automatically.

## 2b. Container route instead

If you prefer ECR + App Runner, or ECS Fargate:

    cd system
    docker build -f server/Dockerfile -t castmir .
    aws ecr create-repository --repository-name castmir
    docker tag castmir:latest <acct>.dkr.ecr.us-east-1.amazonaws.com/castmir:latest
    aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
    docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/castmir:latest

Then create the App Runner service from the image, same port, env vars and instance role.

---

## 3. Custom domain (optional)

App Runner → your service → **Custom domains** → add e.g. `castmir.your-institution.edu`,
then add the CNAME records it prints to your DNS. Certificates are issued automatically.
Do this before wide rollout: the extension download bakes in whatever host served it, so
distributing the App Runner URL and switching domains later means users re-download.

---

## 4. Roll out the extension

Send users to `https://<your-url>/` and let them follow the seven steps, or distribute the
zip from `/download/castmir-extension.zip` yourself.

For managed devices, publish the extension by policy instead of Load unpacked:
package the folder to a `.crx`, host it, and push `ExtensionInstallForcelist` via group
policy or Jamf. The server side does not change.

---

## 5. Verify the deployment

    curl https://<your-url>/v1/health
    curl https://<your-url>/v1/org/policy
    curl -X POST https://<your-url>/v1/prompts/analyze \
      -H 'content-type: application/json' \
      -d '{"prompt":"write something about our Q3 numbers for john@acme.com","user_id":"smoke-test","host":"chatgpt.com"}'

The third call should come back with a quality score, a suggested revision, and an `email`
finding with action `redact`. Then open `/admin.html` — the smoke-test event appears.
Delete it later by removing the S3 object.

---

## Operating notes

- **Scaling.** The JSON store assumes one writer. Set App Runner **max size to 1** instance,
  or move `store.js` to DynamoDB/RDS before scaling out. This is the one real constraint.
- **Retention.** `policy.retention_days` (default 90) prunes on every write. Change it with
  `PUT /v1/org/policy` and the admin key.
- **Cost.** A pilot-sized App Runner service is roughly \$5–25/month; S3 for this object is
  cents.
- **Privacy.** Set `storage_mode` to `metadata` or `none` in policy if the institution's
  review requires that no prompt text is retained. Scores and findings still work.
