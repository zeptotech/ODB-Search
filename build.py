import xml.etree.ElementTree as ET
import json


def build_formulary(input_file='formulary.xml', output_file='formulary.json'):
    print(f'Parsing {input_file}...')
    tree = ET.parse(input_file)
    root = tree.getroot()

    create_date = root.attrib.get('createDate', '')
    formulary = root.find('formulary')

    entries = []

    for pcg2 in formulary:
        if pcg2.tag != 'pcg2':
            continue
        category = pcg2.findtext('name', '')

        for generic_name_elem in pcg2.iter('genericName'):
            generic = generic_name_elem.findtext('name', '')

            for pcg_group in generic_name_elem.findall('pcgGroup'):
                lcc_id = pcg_group.attrib.get('lccId')

                # Parse LU criteria notes
                lu_criteria = []
                lu_periods = []

                for note_elem in pcg_group.findall('lccNote'):
                    note_type = note_elem.attrib.get('type')
                    note_text = (note_elem.text or '').strip()
                    note_seq = note_elem.attrib.get('seq', '')
                    reason_id = note_elem.attrib.get('reasonForUseId')

                    if note_text.startswith('LU Authorization Period:'):
                        period = note_text.replace('LU Authorization Period:', '').strip()
                        if period not in lu_periods:
                            lu_periods.append(period)

                    note_entry = {'seq': note_seq, 'type': note_type, 'text': note_text}
                    if reason_id:
                        note_entry['reasonForUseId'] = reason_id
                    lu_criteria.append(note_entry)

                has_lu_notes = len(lu_criteria) > 0
                lu_period_str = ', '.join(lu_periods) if lu_periods else None

                # Collect the actual LU codes (reasonForUseId values)
                lu_codes = []
                for note_entry in lu_criteria:
                    rid = note_entry.get('reasonForUseId')
                    if rid and rid not in lu_codes:
                        lu_codes.append(rid)


                for pcg9 in pcg_group.findall('pcg9'):
                    strength = pcg9.findtext('strength', '')
                    form = pcg9.findtext('dosageForm', '')
                    pcg9_note = (pcg9.findtext('note') or '').strip() or None

                    products = []
                    search_names = {generic.lower()}
                    any_benefit = False

                    for drug in pcg9.findall('drug'):
                        din = drug.attrib.get('id', '')
                        brand_name = drug.findtext('name', '')
                        not_benefit = 'notABenefit' in drug.attrib
                        drug_note = (drug.findtext('note') or '').strip() or None

                        if not not_benefit:
                            any_benefit = True

                        search_names.add(brand_name.lower())

                        search_names.add(din)

                        prod = {'din': din, 'name': brand_name}
                        if not_benefit:
                            prod['notABenefit'] = True
                        if drug_note:
                            prod['note'] = drug_note
                        products.append(prod)

                    # Determine group-level status
                    if lcc_id and has_lu_notes:
                        status = 'limited_use'
                    elif any_benefit:
                        status = 'general_benefit'
                    else:
                        status = 'not_a_benefit'

                    entry = {
                        'genericName': generic,
                        'category': category,
                        'strength': strength,
                        'form': form,
                        'status': status,
                        'products': products,
                        'searchNames': sorted(search_names),
                    }

                    if pcg9_note:
                        entry['note'] = pcg9_note
                    if lcc_id and has_lu_notes:
                        entry['luCodes'] = lu_codes
                        entry['luPeriod'] = lu_period_str
                        entry['luCriteria'] = lu_criteria

                    entries.append(entry)

    output = {'generated': create_date, 'drugs': entries}

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    print(f'Done. {len(entries)} entries written to {output_file}')


if __name__ == '__main__':
    build_formulary()
