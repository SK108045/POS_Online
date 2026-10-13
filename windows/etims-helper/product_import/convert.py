"""Offline CSV -> eTIMS 20240411 product workbook. Python standard library only."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
import io
import locale
import math
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


FIELDS = (
    "Tin", "ItemCd", "ItemClsCd", "ItemTyCd", "ItemNm", "ItemStdNm",
    "OrgnNatCd", "PkgUnitCd", "QtyUnitCd", "TaxTyCd", "Bcd", "RegBhfId",
    "UseYn", "RraModYn", "AddInfo", "SftyQty", "IsrcAplcbYn", "DftPrc",
    "GrpPrcL1", "GrpPrcL2", "GrpPrcL3", "GrpPrcL4", "GrpPrcL5", "RegrId",
    "RegrNm", "RegDt", "ModrId", "ModrNm", "ModDt", "InitlWhUntpc",
    "InitlQty", "Rm", "UseBarcode", "UseAdiYn", "BatchNum", "UseExpiration",
)
NUMBER_FIELDS = frozenset((
    "SftyQty", "DftPrc", "GrpPrcL1", "GrpPrcL2", "GrpPrcL3", "GrpPrcL4",
    "GrpPrcL5", "InitlWhUntpc", "InitlQty",
))
REQUIRED_TEXT = frozenset((
    "ItemCd", "ItemClsCd", "ItemTyCd", "ItemNm", "OrgnNatCd", "PkgUnitCd",
    "QtyUnitCd", "TaxTyCd", "UseYn",
))
YN_FIELDS = frozenset(("UseYn", "RraModYn", "IsrcAplcbYn", "UseAdiYn"))
CODE_FIELDS = frozenset((
    "Tin", "ItemCd", "ItemClsCd", "ItemTyCd", "OrgnNatCd", "PkgUnitCd",
    "QtyUnitCd", "TaxTyCd", "Bcd", "RegBhfId", "UseBarcode", "UseExpiration",
    "UseYn", "RraModYn", "IsrcAplcbYn", "UseAdiYn",
))
MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_ROWS = 10_000
MAX_ERRORS = 25
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
DECIMAL_RE = re.compile(r"[0-9]+(?:\.[0-9]+)?\Z", re.ASCII)


class ValidationError(Exception):
    """Messages deliberately contain no supplied cell values."""


def _xml_text_ok(value: str) -> bool:
    return all(
        ord(c) in (9, 10, 13)
        or 0x20 <= ord(c) <= 0xD7FF
        or 0xE000 <= ord(c) <= 0xFFFD
        or 0x10000 <= ord(c) <= 0x10FFFF
        for c in value
    )


def _numeric(value: str) -> str:
    if not DECIMAL_RE.fullmatch(value):
        raise ValueError("enter a nonnegative decimal using a dot, or explicit 0")
    try:
        amount = Decimal(value)
        as_double = float(amount)
    except (InvalidOperation, OverflowError, ValueError):
        raise ValueError("number cannot be represented by the client's Double parser") from None
    if not amount.is_finite() or not math.isfinite(as_double):
        raise ValueError("number is outside the client's finite Double range")
    if amount != 0 and as_double == 0:
        raise ValueError("number would underflow to zero in the client")
    # The application stores Double, so avoid promising preservation beyond 15 digits.
    significant = value.lstrip("0").replace(".", "").lstrip("0").rstrip("0")
    if len(significant) > 15:
        raise ValueError("use at most 15 significant digits for the client's Double fields")
    result = format(amount, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return result or "0"


def load_csv(path: Path) -> tuple[list[list[str]], int]:
    """Validate the complete CSV before returning any workbook rows."""
    if path.suffix.lower() != ".csv":
        raise ValidationError("Input must have a .csv extension.")
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_INPUT_BYTES + 1)
    except OSError:
        raise ValidationError("Cannot read the input CSV.") from None
    if len(raw) > MAX_INPUT_BYTES:
        raise ValidationError("Input exceeds the 20 MiB limit.")
    try:
        source = raw.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        raise ValidationError("Input must be UTF-8 CSV; UTF-8 with BOM is also accepted.") from None
    reader = csv.reader(io.StringIO(source, newline=""), strict=True)
    try:
        header = next(reader)
    except StopIteration:
        raise ValidationError("CSV is empty; start with template.csv.") from None
    except csv.Error:
        raise ValidationError("CSV header has malformed quoting.") from None
    # Unknown header names may themselves contain private data; never echo them.
    if len(header) != len(FIELDS) or len(set(header)) != len(FIELDS) or set(header) != set(FIELDS):
        raise ValidationError("CSV must contain each of the 36 template headers exactly once, with no extra headers.")
    positions = [header.index(name) for name in FIELDS]
    errors: list[str] = []
    rows: list[list[str]] = []
    skipped = 0
    seen: set[str] = set()

    def error(line: int, field: str, reason: str) -> None:
        if len(errors) < MAX_ERRORS:
            errors.append(f"Line {line}, {field}: {reason}.")

    try:
        for original in reader:
            line = reader.line_num
            if not original or all(value == "" for value in original):
                skipped += 1
                continue
            if len(rows) >= MAX_ROWS:
                raise ValidationError("CSV exceeds the 10,000 nonblank row limit.")
            if len(original) != len(FIELDS):
                error(line, "row", "expected exactly 36 cells; check CSV quoting")
                continue
            row = [original[position] for position in positions]
            for index, field in enumerate(FIELDS):
                value = row[index]
                if not _xml_text_ok(value):
                    error(line, field, "contains characters unsupported by XML 1.0")
                    continue
                if len(value.encode("utf-16-le")) // 2 > 32767:
                    error(line, field, "exceeds the Excel cell text limit")
                if field in REQUIRED_TEXT and not value.strip():
                    error(line, field, "value required; no code is inferred")
                if field in CODE_FIELDS and value != value.strip():
                    error(line, field, "remove surrounding whitespace explicitly")
                if field in CODE_FIELDS and any(c in value for c in "\r\n\t"):
                    error(line, field, "code must be a single line without tabs")
                if field in NUMBER_FIELDS:
                    try:
                        row[index] = _numeric(value)
                    except ValueError as exc:
                        error(line, field, str(exc))
                if field in YN_FIELDS and value and value not in ("Y", "N"):
                    error(line, field, "use uppercase Y or N")
                if field == "ItemClsCd" and len(value) > 10:
                    error(line, field, "native importer permits at most 10 characters")
                if field == "ItemTyCd" and value not in ("1", "2", "3"):
                    error(line, field, "choose a verified client type code 1, 2, or 3")
            item_code = row[FIELDS.index("ItemCd")]
            if item_code in seen:
                error(line, "ItemCd", "duplicate product code in this CSV")
            seen.add(item_code)
            rows.append(row)
    except csv.Error:
        error(reader.line_num, "row", "malformed CSV quoting")
    if errors:
        suffix = "\nError output is limited to 25 entries." if len(errors) == MAX_ERRORS else ""
        raise ValidationError("\n".join(errors) + suffix)
    if not rows:
        raise ValidationError("CSV contains no product rows; template.csv contains headers only.")
    return rows, skipped


def decimal_separator() -> str:
    # Set only this process's parsing culture; no Windows settings are changed.
    locale.setlocale(locale.LC_NUMERIC, "")
    return locale.localeconv()["decimal_point"]


def check_culture() -> None:
    try:
        separator = decimal_separator()
    except (locale.Error, KeyError):
        raise ValidationError("Cannot verify decimal culture; this client requires a dot-decimal import environment.") from None
    if separator != ".":
        raise ValidationError("Use this helper and import on a Windows account whose decimal separator is a dot. The native parser is culture-dependent.")


def check_output_path(path: Path, source: Path) -> None:
    if path.suffix.lower() != ".xlsx":
        raise ValidationError("Output must have an .xlsx extension.")
    try:
        resolved = path.resolve()
        if resolved == source.resolve():
            raise ValidationError("Input and output must be different files.")
        try:
            from settings import settings
        except ModuleNotFoundError:
            # Also support running this converter directly from its folder.
            sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
            from settings import settings
        config=settings()
        protected = [Path(config['installation_dir']),Path(config['database_path']).parent]
        for env_name in ("LOCALAPPDATA", "APPDATA"):
            if os.environ.get(env_name):
                protected.append(Path(os.environ[env_name]) / "EBM2x")
        for directory in protected:
            if resolved.is_relative_to(directory.resolve()):
                raise ValidationError("Write the workbook to your own import folder, outside eTIMS application and application-data folders.")
        if not resolved.parent.is_dir():
            raise ValidationError("Output parent folder must already exist.")
        if resolved.exists():
            raise ValidationError("Output already exists; choose a new filename. Existing files are never overwritten.")
    except OSError:
        raise ValidationError("Cannot resolve the output path.") from None


def _column(index: int) -> str:
    text = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        text = chr(65 + remainder) + text
    return text


def _xml(root: ET.Element) -> bytes:
    # .NET Framework's WindowsBase OPC reader requires unprefixed Types and
    # Relationships roots, despite equivalent prefixed XML being well-formed.
    ET.register_namespace('r', DOC_REL_NS)
    ET.register_namespace('', root.tag[1:].split('}', 1)[0])
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def workbook_bytes(rows: list[list[str]]) -> bytes:
    """Every row has all 36 explicit cells; text (including blanks) uses shared strings."""
    namespace = lambda name: f"{{{SHEET_NS}}}{name}"
    shared: list[str] = []
    lookup: dict[str, int] = {}
    text_cells = 0
    sheet = ET.Element(namespace("worksheet"))
    ET.SubElement(sheet, namespace("dimension"), ref=f"A1:AJ{len(rows) + 1}")
    data = ET.SubElement(sheet, namespace("sheetData"))
    for row_number, values in enumerate([list(FIELDS), *rows], start=1):
        row = ET.SubElement(data, namespace("row"), r=str(row_number))
        for index, (field, value) in enumerate(zip(FIELDS, values), start=1):
            numeric = row_number > 1 and field in NUMBER_FIELDS
            cell = ET.SubElement(row, namespace("c"), r=f"{_column(index)}{row_number}", t="n" if numeric else "s")
            if numeric:
                ET.SubElement(cell, namespace("v")).text = value
            else:
                text_cells += 1
                if value not in lookup:
                    lookup[value] = len(shared)
                    shared.append(value)
                ET.SubElement(cell, namespace("v")).text = str(lookup[value])
    strings = ET.Element(namespace("sst"), count=str(text_cells), uniqueCount=str(len(shared)))
    for value in shared:
        item = ET.SubElement(strings, namespace("si"))
        ET.SubElement(item, namespace("t"), {XML_SPACE: "preserve"}).text = value
    book = ET.Element(namespace("workbook"))
    sheets = ET.SubElement(book, namespace("sheets"))
    ET.SubElement(sheets, namespace("sheet"), name="TaxpayerItem", sheetId="1", attrib={f"{{{DOC_REL_NS}}}id": "rId1"})
    root_rels = ET.Element(f"{{{PKG_REL_NS}}}Relationships")
    ET.SubElement(root_rels, f"{{{PKG_REL_NS}}}Relationship", Id="rId1", Type=f"{DOC_REL_NS}/officeDocument", Target="xl/workbook.xml")
    book_rels = ET.Element(f"{{{PKG_REL_NS}}}Relationships")
    ET.SubElement(book_rels, f"{{{PKG_REL_NS}}}Relationship", Id="rId1", Type=f"{DOC_REL_NS}/worksheet", Target="worksheets/sheet1.xml")
    ET.SubElement(book_rels, f"{{{PKG_REL_NS}}}Relationship", Id="rId2", Type=f"{DOC_REL_NS}/sharedStrings", Target="sharedStrings.xml")
    types = ET.Element(f"{{{CONTENT_NS}}}Types")
    ET.SubElement(types, f"{{{CONTENT_NS}}}Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(types, f"{{{CONTENT_NS}}}Default", Extension="xml", ContentType="application/xml")
    for part, content_type in (
        ("/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        ("/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"),
        ("/xl/sharedStrings.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"),
    ):
        ET.SubElement(types, f"{{{CONTENT_NS}}}Override", PartName=part, ContentType=content_type)
    result = io.BytesIO()
    with ZipFile(result, "w", compression=ZIP_DEFLATED) as archive:
        for name, document in (
            ("[Content_Types].xml", types), ("_rels/.rels", root_rels),
            ("xl/workbook.xml", book), ("xl/_rels/workbook.xml.rels", book_rels),
            ("xl/worksheets/sheet1.xml", sheet), ("xl/sharedStrings.xml", strings),
        ):
            archive.writestr(name, _xml(document))
    return result.getvalue()


def check_existing(rows: list[list[str]], existing: Path | None) -> None:
    if existing is None:
        return
    try:
        if existing.stat().st_size > MAX_INPUT_BYTES:
            raise ValidationError('Existing-product CSV exceeds the 20 MiB limit.')
        with existing.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream, strict=True)
            if not reader.fieldnames or reader.fieldnames.count('ItemCd') != 1:
                raise ValidationError('Existing-product CSV must have exactly one ItemCd header.')
            codes = {record['ItemCd'] for record in reader}
    except (OSError, UnicodeError, csv.Error, KeyError):
        raise ValidationError('Cannot read existing-product CSV; check its encoding and ItemCd column.') from None
    conflicts = sum(row[FIELDS.index('ItemCd')] in codes for row in rows)
    if conflicts:
        raise ValidationError(f'{conflicts} product row(s) already exist in the supplied list. Native import can change existing stock; use new product codes only.')


def convert(source: Path, output: Path | None = None, existing: Path | None = None) -> tuple[int, int]:
    rows, skipped = load_csv(source)
    check_existing(rows, existing)
    check_culture()
    if output is not None:
        check_output_path(output, source)
        data = workbook_bytes(rows)
        try:
            # Exclusive creation prevents races from overwriting an existing file.
            with output.open("xb") as stream:
                stream.write(data)
        except FileExistsError:
            raise ValidationError("Output already exists; choose a new filename.") from None
        except OSError:
            raise ValidationError("Could not finish writing the workbook; check disk space and permissions. A partial new file may remain.") from None
    return len(rows), skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="validate only; write nothing")
    action.add_argument("--output", type=Path, help="create a new XLSX; never overwrite")
    parser.add_argument('--existing-csv', type=Path, help='reject matching ItemCd codes from a current CSV containing an ItemCd column')
    arguments = parser.parse_args(argv)
    try:
        count, skipped = convert(arguments.csv_file, arguments.output, arguments.existing_csv)
    except ValidationError as exc:
        print(f"Validation failed:\n{exc}", file=sys.stderr)
        return 2
    except (KeyboardInterrupt, BrokenPipeError):
        return 130
    print(f"Validated {count} product row(s); skipped {skipped} empty CSV row(s).")
    print("Created a new XLSX." if arguments.output else "Check only: no file created.")
    print("Code validity and existing products still require review in eTIMS. No records imported.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
