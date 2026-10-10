"""Extract data-only FANS PER descriptors from a pinned libacars checkout.

No upstream code is executed. Fail closed if a descriptor shape is unsupported.
"""
import json
import pathlib
import re
import sys

revision = "9af09a0121d4ec577339cbd4c7420d7519da48fa"
source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
nodes = {}
for path in sorted(source.glob("FANS*.c")):
    text = path.read_text(encoding="utf-8")
    match = re.search(
        r"static asn_per_constraints_t[^=]*=\s*\{\s*"
        r"\{[^,]+,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\}[^\n]*\n\s*"
        r"\{[^,]+,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\}",
        text,
    )
    constraints = list(map(int, match.groups())) if match else None
    if "static asn_per_constraints_t" in text and constraints is None:
        raise ValueError(f"Unrecognized constraints: {path.name}")
    members = re.search(r"static asn_TYPE_member_t[^=]*=\s*\{(.*?)\n};", text, re.S)
    if members:
        fields = []
        for block in re.findall(r"\{(.*?)\n\s*\}", members[1], re.S):
            field_type = re.search(r"&asn_DEF_(\w+)", block)
            field_name = re.search(r'"([^"]*)"\s*$', block.strip())
            flags = re.match(r"\s*ATF_(\w+)", block)
            if not field_type or not field_name or not flags:
                raise ValueError(f"Unrecognized member: {path.name}")
            fields.append([field_name[1], field_type[1], flags[1] == "POINTER"])
        kind = re.search(r"\n\s*(SEQUENCE_OF|SEQUENCE|CHOICE)_decode_uper,", text)[1]
        node = {"kind": kind, "constraints": constraints, "members": fields}
    else:
        alias = re.search(r"td->uper_decoder\s*=\s*asn_DEF_(\w+)", text)
        if not alias:
            raise ValueError(f"Unrecognized scalar: {path.name}")
        node = {"kind": alias[1], "constraints": constraints}
    enums = re.search(r"static const asn_INTEGER_enum_map_t[^=]*=\s*\{(.*?)\n};", text, re.S)
    if enums:
        node["enumeration"] = {
            value: label for value, label in re.findall(r'\{\s*(-?\d+),\s*\d+,\s*"([^"]+)"\s*\}', enums[1])
        }
    if "Start extensions" in text and not re.search(r"-1,\s*/\* Start extensions \*/", text):
        raise ValueError(f"Unexpected extension: {path.name}")
    nodes[path.stem] = node
if len(nodes) != 213:
    raise ValueError(f"Expected 213 pinned descriptors, got {len(nodes)}")
target.write_text(json.dumps({"revision": revision, "nodes": nodes}, indent="\t") + "\n", encoding="utf-8")
print(f"Extracted {len(nodes)} FANS descriptors without executing upstream code.")
