# Put Credo online (free, about 15 minutes)

You end up with a public link (like `https://credo-demo.onrender.com`) that works without your laptop.
Two free accounts are needed: **GitHub** stores the code, **Render** runs it.
Button names on these sites may differ slightly from what's written here.

## Step 1 — Put the code on GitHub

1. Go to https://github.com/signup and create an account (skip this if you have one).
2. Click **+** (top right) → **New repository**.
   - Name: `credo-demo`
   - Choose **Private** (Render can still use it)
   - Click **Create repository**.
3. On the empty repository page, click the link **uploading an existing file**.
4. In Finder, open your **Claude** folder and drag in **only these**:
   - `server.py`
   - `requirements.txt`
   - `render.yaml`
   - `README.md`
   - `ARCHITECTURE.md`
   - the whole `static` folder
   
   Do **not** upload `data`, `Artifacts` or `Scheduled`.
5. Click **Commit changes**.
6. Check that the repository now shows `server.py`, `render.yaml` and a `static` folder at the top level.

## Step 2 — Run it on Render

1. Go to https://render.com and sign up with **GitHub** (the "GitHub" sign-in button).
2. Allow Render to access your `credo-demo` repository when asked.
3. In the Render dashboard, click **New +** → **Blueprint**.
4. Pick `credo-demo` and click **Apply**. Render reads `render.yaml` and sets everything up.

   If you don't see Blueprint, use **New +** → **Web Service** instead and fill in:
   - Repository: `credo-demo`
   - Language/Runtime: **Python 3**
   - Build command: `pip install -r requirements.txt`
   - Start command: `python3 server.py`
   - Instance type: **Free**
5. Wait until the status says **Live** (2–5 minutes). Your link is shown at the top of the page.
6. Open the link and click **Try the demo**. You should see the persona picker.

## Before the professor grades it

- **Wake it up first.** The free plan sleeps after ~15 minutes without visitors. The first visit can take up to a minute. Open the link yourself shortly before you send it.
- **What to send:** the link, plus one line: *"Click 'Try the demo' and pick a persona (start with Alex Morgan, the applicant)."*
- **Clean data:** the demo data resets to the starting state whenever Render restarts the app. You can also reset it yourself with **Reset demo data** on the sign-in page.

## Changing the app later

Upload the changed files to the same GitHub repository (same "Add file → Upload files" button). Render redeploys automatically within a few minutes.

## Good to know

- Anyone with the link can use the demo, including the reset button. It contains only fictional data.
- The demo names IE University as an example destination. A class submission is fine; for anything public (LinkedIn, press, pitch events), get IE Communications to review it first.
- To run it on your own Mac instead: open Terminal, run `cd ~/Claude`, then `python3 server.py`, and visit http://localhost:8787.
