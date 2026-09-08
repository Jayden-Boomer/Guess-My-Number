import os
from cloudflare import Cloudflare
from dotenv import load_dotenv

load_dotenv()

api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
if not api_token:
    raise SystemExit("CLOUDFLARE_API_TOKEN is missing. Add it to .env before running this script.")

client = Cloudflare(
    api_token=api_token,
)
turn = client.calls.turn.create(
    account_id="023e105f4ecef8ad9ca31a8372d0c353",
)
print(turn.uid)