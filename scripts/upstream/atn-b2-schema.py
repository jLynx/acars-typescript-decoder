"""Read data-only asn1c descriptors from pinned dumpvdl2, never executing C."""
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
nodes = {}
constraints = {}
primitive = {"NativeInteger": "constrained_integer", "NativeEnumerated": "enumerated", "NULL": "null", "BOOLEAN": "boolean", "IA5String": "restricted_character_string", "NumericString": "NumericString", "BIT_STRING": "bit_string", "OCTET_STRING": "octet_string", "OBJECT_IDENTIFIER": "oid", "RELATIVE_OID": "relative-oid"}

reachable = set()
def visit(name):
    if name in reachable:
        return
    reachable.add(name)
    path = root / (name + ".c")
    if not path.exists():
        return
    for child in set(re.findall(r"asn_DEF_(\w+)", path.read_text(encoding="utf-8"))):
        if child not in primitive and not child.endswith("_specs"):
            visit(child)
for name in ["ATCUplinkMessage", "ATCDownlinkMessage", "ProtectedGroundPDUs", "ProtectedAircraftPDUs", "ADSAircraftPDUs", "ADSGroundPDUs", "ADSReport", "ADSRequestContract", "ADSAccept", "ADSReject", "ADSNonCompliance", "ADSPositiveAcknowledgement"]:
    visit(name)

for path in sorted(root.glob("*.c")):
    source = path.read_text(encoding="utf-8")
    if path.stem not in reachable:
        continue
    module = re.search(r'From ASN.1 module "([^"]+)"', source)
    if not module:
        continue
    pattern = r"static asn_per_constraints_t (\w+)[^=]*=\s*\{\s*\{([^}]+)\}[^\n]*\n\s*\{([^}]+)\}"
    local_constraints = {}
    for name, value, size in re.findall(pattern, source):
        def fields(text):
            values = text.split(",")
            return [values[0].strip(), *[int(v.strip()) for v in values[1:]]]
        local_constraints[name] = [fields(value), fields(size)]
    if len(local_constraints) != source.count("static asn_per_constraints_t"):
        raise ValueError(f"Unsupported constraints in {path.name}")
    members = dict(re.findall(r"static asn_TYPE_member_t (\w+)\[\] = \{(.*?)\n\};", source, re.S))
    specific = dict(re.findall(r"static asn_(?:SEQUENCE|CHOICE|SET_OF)_specifics_t (\w+) = \{(.*?)\n\};", source, re.S))
    descriptors = re.findall(r"asn_TYPE_descriptor_t asn_DEF_(\w+) = \{(.*?)\n\};", source, re.S)
    for name, body in descriptors:
        kind = re.search(r"\n\s*(SEQUENCE_OF|SEQUENCE|CHOICE)_decode_uper,", body)
        node = {"module": module[1]}
        per_ref = re.search(r"&((?:asn_PER_)[\w]+)", body)
        constraint = local_constraints[per_ref[1]] if per_ref else None
        if kind:
            kind = kind[1]
            node["kind"] = {"SEQUENCE_OF": "constrained_sequence_of", "SEQUENCE": "sequence", "CHOICE": "choice"}[kind]
            table_name = re.search(r"\n\s*(asn_MBR_\w+),", body)[1]
            table = members[table_name]
            parsed = []
            for block in re.findall(r"\{(.*?)\n\s*\}", table, re.S):
                target = re.search(r"&asn_DEF_(\w+)", block)
                label = re.search(r'"([^"]*)"\s*$', block.strip())
                if not target or not label:
                    raise ValueError(f"Unsupported member {path.name}/{name}")
                entry = {"name": label[1], "type": target[1], "optional": bool(re.match(r"\s*ATF_POINTER,\s*[1-9]", block)), "extension": False}
                default = re.search(r"/\* DEFAULT (-?\d+) \*/", block)
                if default:
                    entry["defaultValue"] = int(default[1])
                override = re.search(r"&(asn_PER_\w+)", block)
                if override:
                    entry["constraints"] = local_constraints[override[1]]
                parsed.append(entry)
            if len(parsed) != table.count("&asn_DEF_"):
                raise ValueError(f"Missed member {path.name}/{name}")
            node["members"] = parsed
            specifics = specific[re.search(r"&(asn_SPC_\w+)\s*/\* Additional specs", body)[1]]
            if kind == "CHOICE":
                extensions = int(re.search(r"(-?\d+)\s*/\* Extensions start", specifics)[1])
                node["extensible"] = extensions >= 0
                for i, member in enumerate(parsed):
                    member["index"] = i
                    member["extension"] = extensions >= 0 and i >= extensions
            elif kind == "SEQUENCE":
                start = int(re.search(r"(-?\d+),\s*/\* Start extensions", specifics)[1])
                stop = int(re.search(r"(-?\d+)\s*/\* Stop extensions", specifics)[1])
                node["extensible"] = start >= 0
                for i, member in enumerate(parsed):
                    member["extension"] = start >= 0 and start < i < stop
            else:
                if not constraint or "UNCONSTRAINED" in constraint[1][0]:
                    node.update(minimum=None, maximum=None, extensible=False)
                else:
                    node.update(minimum=constraint[1][3], maximum=constraint[1][4], extensible="EXTENSIBLE" in constraint[1][0])
        else:
            alias = re.search(r"td->uper_decoder\s*=\s*asn_DEF_(\w+)", source)
            if not alias:
                raise ValueError(f"Unsupported scalar {path.name}/{name}")
            target = alias[1]
            node["kind"] = primitive.get(target, "alias")
            if target not in primitive:
                node["type"] = target
            if constraint:
                group = constraint[0] if target in ("NativeInteger", "NativeEnumerated") else constraint[1]
                node.update(minimum=group[3], maximum=group[4], extensible="EXTENSIBLE" in group[0])
                if target == "NativeEnumerated":
                    node["count"] = group[4] - group[3] + 1
            elif target in ("BIT_STRING", "OCTET_STRING", "NativeInteger"):
                node.update(minimum=None, maximum=None, extensible=False)
            elif target not in ("NULL", "BOOLEAN", "OBJECT_IDENTIFIER", "RELATIVE_OID") and target in primitive:
                raise ValueError(f"Unconstrained scalar {path.name}/{name}")
            enums = re.search(r"static const asn_INTEGER_enum_map_t[^=]*=\s*\{(.*?)\n\};", source, re.S)
            if enums:
                node["enumeration"] = dict(re.findall(r'\{\s*(-?\d+),\s*\d+,\s*"([^"]+)"\s*\}', enums[1]))
        if name in nodes:
            raise ValueError(f"Duplicate type {name}")
        nodes[name] = node

for node in nodes.values():
    if node.get("type") and node["type"] not in nodes and node["type"] not in primitive:
        raise ValueError(f"Missing alias type {node['type']}")
    for member in node.get("members", []):
        if member["type"] not in nodes and member["type"] not in primitive:
            raise ValueError(f"Missing type {member['type']}")
for name, kind in primitive.items():
    if name not in nodes:
        nodes[name] = {"kind": kind, "minimum": None, "maximum": None}
for name, node in list(nodes.items()):
    for member in node.get("members", []):
        if "constraints" in member:
            constraint = member.pop("constraints")
            scalar = dict(nodes[member["type"]])
            group = constraint[0] if scalar["kind"] in ("constrained_integer", "enumerated") else constraint[1]
            scalar.update(minimum=group[3], maximum=group[4], extensible="EXTENSIBLE" in group[0])
            if scalar["kind"] == "enumerated":
                scalar["count"] = group[4] - group[3] + 1
            target = name + "__" + member["name"].replace("-", "_")
            nodes[target] = scalar
            member["type"] = target
Path(sys.argv[2]).write_text(json.dumps({"revision": "686e87f2294ef6275855ba7364bd4bb9a0f8f56a", "nodes": nodes}, indent="\t") + "\n", encoding="utf-8", newline="\n")
print(f"Extracted {len(nodes)} pinned ATN descriptors without executing C.")
