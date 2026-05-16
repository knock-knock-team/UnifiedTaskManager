import json
from typing import Dict


def normalize_json(s: str) -> str:
    normalized_s = s.replace("{{", "{").replace("}}", "}")
    return normalized_s


def safe_parse_json(s: str) -> Dict:
    normalized_json = normalize_json(s)
    result = json.loads(normalized_json)
    return result if isinstance(result, dict) else {}