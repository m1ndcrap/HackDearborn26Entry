"""Live check against openFDA. Run from the api folder:  python check_openfda.py

- Confirms label lookups work (and whether your OPENFDA_API_KEY is being used)
- Shows the no-match case
- Runs a full safety report on the demo medicines and prints every flag with its citation
- Warms the label cache (api/.label_cache) so the demo works even on bad Wi-Fi
"""
import time

from app import openfda, safety
from app.models import Medication, Profile

DEMO = [("Coumadin", "warfarin"), ("Advil", "ibuprofen"), ("Synthroid", "levothyroxine"), ("Tums", "calcium carbonate"),
        ("Tylenol", "acetaminophen"), ("Lipitor", "atorvastatin"), ("Zoloft", "sertraline"), ("Ultram", "tramadol"),
        ("Zestril", "lisinopril"), ("Cipro", "ciprofloxacin")]

print(f"API key: {'yes' if openfda.API_KEY else 'no (1,000 requests/day limit)'} | cache: {openfda.CACHE_DIR}\n")
for name, ing in DEMO + [("Nonsense", "notarealdrugxyz")]:
    t = time.time()
    r = safety.fetch_label_section(ing)
    took = f"{time.time() - t:.1f}s"
    if r.get("found"):
        print(f"OK   {ing:18} {took:>5}  {r.get('brand')} | sections: {', '.join(r['sections'])}")
    else:
        print(f"--   {ing:18} {took:>5}  {r.get('reason')} {r.get('error', '')}")

print("\nSafety report for the demo profile (allergy: NSAIDs, condition: kidney disease):\n")
meds = [Medication(id=str(i), name=n, ingredients=[g], ingredient=g, warnings=[], confidence=1) for i, (n, g) in enumerate(DEMO)]
rep = safety.build_report(Profile(id="p", name="Dad", allergies=["NSAIDs"], conditions=["kidney disease"]), meds)
for f in rep.flags:
    print(f"[{f.severity}] {f.title} ({' + '.join(f.drugs)})\n    {f.source}\n    {f.excerpt or ''}\n    {f.source_url or ''}\n")
print("Couldn't check:", rep.unchecked or "none")