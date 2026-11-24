"""
יצירה: טוען מודל מאומן ומייצר מילים חדשות.

    python3 generate.py                 # 20 שמות חדשים
    python3 generate.py -n 50 -t 1.2    # יותר "יצירתי" (טמפרטורה גבוהה)
    python3 generate.py --start אל      # שמות שמתחילים ב"אל"
"""

import argparse
import os

from model import GPT, sample

HERE = os.path.dirname(os.path.abspath(__file__))

p = argparse.ArgumentParser()
p.add_argument("--model", default=os.path.join(HERE, "model.json"))
p.add_argument("-n", type=int, default=20)
p.add_argument("-t", "--temperature", type=float, default=0.8)
p.add_argument("--start", default="")
args = p.parse_args()

model, vocab = GPT.load(args.model)
for _ in range(args.n):
    print(sample(model, vocab, args.temperature, args.start))
