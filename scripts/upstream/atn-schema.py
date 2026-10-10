"""Extract data-only ATN CPDLC layouts from pinned Wireshark generated C.

Never execute upstream code. Fail closed for unsupported calls or table shapes.
"""
from pathlib import Path
import json
import re
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
nodes = {}
functions = re.findall(r"static unsigned\s+dissect_atn_cpdlc_(\w+)\([^\n]*\)\s*\{(.*?)\n\}", source, re.S)
tables = dict(re.findall(r"static const per_(?:sequence|choice)_t (\w+)\[.*?\] = \{(.*?)\n\};", source, re.S))
labels = dict(re.findall(r'&hf_atn_cpdlc_(\w+),\s*\{\s*"([^"]+)"', source))
for name, body in functions:
    call = re.search(r"dissect_per_(\w+)\((.*?)\);", body, re.S)
    if not call:
        if name == "RemainingFuel":
            nodes[name] = {"kind": "alias", "type": "Time"}
        elif name == "AlgorithmIdentifier":
            nodes[name] = {"kind": "relative-oid"}
        else:
            raise ValueError(f"Unsupported function {name}")
        continue
    kind, arguments = call.groups()
    args = [arg.strip() for arg in arguments.split(",")][5:]
    node = {"kind": kind}
    if kind in ("sequence", "choice", "constrained_sequence_of"):
        table = tables[args[1]]
        members = []
        if kind == "choice":
            matches = re.findall(r"\{\s*(\d+),\s*&hf_atn_cpdlc_(\w+)\s*,\s*ASN1_(\w+)\s*,\s*dissect_atn_cpdlc_(\w+)\s*\}", table)
            for index, field, extension, target in matches:
                label = "send" if field.endswith("pdus_send") else labels[field]
                members.append({"name": label, "type": target, "extension": extension == "NOT_EXTENSION_ROOT", "index": int(index)})
        else:
            matches = re.findall(r"\{\s*&hf_atn_cpdlc_(\w+)\s*,\s*ASN1_(\w+)\s*,\s*ASN1_(\w+)\s*,\s*dissect_atn_cpdlc_(\w+)\s*\}", table)
            for field, extension, optional, target in matches:
                members.append({"name": labels[field], "type": target, "extension": extension == "NOT_EXTENSION_ROOT", "optional": optional == "OPTIONAL"})
        if len(members) != table.count("dissect_atn_cpdlc_"):
            raise ValueError(f"Unsupported members {name}")
        node["members"] = members
        node["extensible"] = "ASN1_EXTENSION_ROOT" in table or "ASN1_NOT_EXTENSION_ROOT" in table
        if kind == "constrained_sequence_of":
            node.update(minimum=int(args[2]), maximum=int(args[3]), extensible=args[4] == "true")
    elif kind == "constrained_integer":
        node.update(minimum=int(args[0].rstrip("U")), maximum=int(args[1].rstrip("U")), extensible=args[3] == "true")
    elif kind == "enumerated":
        node.update(count=int(args[0]), extensible=args[2] == "true")
        if args[4] != "NULL":
            raise ValueError(f"Unsupported enum map {name}")
        values = re.search(rf"static const value_string atn_cpdlc_{name}_vals\[\] = \{{(.*?)\n\}};", source, re.S)
        if values:
            node["enumeration"] = dict(re.findall(r'\{\s*(\d+),\s*"([^"]+)"\s*\}', values[1]))
    elif kind in ("restricted_character_string", "NumericString", "bit_string"):
        node.update(minimum=None if args[0] == "NO_BOUND" else int(args[0]), maximum=None if args[1] == "NO_BOUND" else int(args[1]), extensible=args[2] == "true")
        if kind == "restricted_character_string" and args[3:5] != ["ia5alpha", "127"]:
            raise ValueError(f"Unsupported alphabet {name}")
    elif kind != "null":
        raise ValueError(f"Unsupported primitive {kind} in {name}")
    nodes[name] = node
if len(nodes) != 243:
    raise ValueError(f"Expected 243 pinned descriptors, got {len(nodes)}")
for name, node in nodes.items():
    for member in node.get("members", []):
        if member["type"] not in nodes:
            raise ValueError(f"Missing member type in {name}: {member['type']}")
Path(sys.argv[2]).write_text(json.dumps({"revision": "ad85ea3cb5af4e9665f1b3e3cda5bee94b71ab73", "nodes": nodes}, indent="\t") + "\n", encoding="utf-8", newline="\n")
print(f"Extracted {len(nodes)} ATN CPDLC layouts without executing upstream code.")
