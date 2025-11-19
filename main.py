import xml.etree.ElementTree as ET

tree = ET.parse("formulary.xml")
root = tree.getroot()

print(root.attrib)

for child in root:
    print(child.tag, child.attrib)