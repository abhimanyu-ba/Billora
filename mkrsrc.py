# Writes a COFF .syso resource object (icon + version info + manifest) that the Go linker embeds into the .exe.
import struct, sys

ico = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
_, _, n = struct.unpack_from('<HHH', ico, 0)
images, grp = [], struct.pack('<HHH', 0, 1, n)
for i in range(n):
    w, h, c, r, planes, bpp, size, off = struct.unpack_from('<BBBBHHII', ico, 6 + 16 * i)
    images.append(ico[off:off + size])
    grp += struct.pack('<BBBBHHIH', w, h, c, r, planes, bpp, size, i + 1)

# Optional 3rd arg: version "1.2.3" (default 1.0.0). Publisher details shown in exe Properties -> Details.
ver = (sys.argv[3] if len(sys.argv) > 3 else '1.0.0').split('.')
ver = [int(x) for x in (ver + ['0'] * 4)[:4]]
VER = '.'.join(map(str, ver))
INFO = {
    'CompanyName': 'Billora',
    'FileDescription': 'Billora - Billing & Business Management',
    'FileVersion': VER,
    'InternalName': 'Billora',
    'LegalCopyright': 'Copyright (C) Billora',
    'OriginalFilename': 'Billora.exe',
    'ProductName': 'Billora',
    'ProductVersion': VER,
}

manifest = ('''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
 <assemblyIdentity type="win32" name="Billora" version="%s"/>
 <description>Billora - Billing &amp; Business Management</description>
 <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
  <requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
 <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
  <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application></compatibility>
 <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
  <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
  <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
 </windowsSettings></application>
</assembly>''' % VER).encode()

def pad4(b): return b + b'\0' * (-len(b) % 4)

def vblock(key, value=b'', wtype=1, children=(), vlen=None):
    # VS_VERSIONINFO-style node: wLength, wValueLength, wType, szKey, pad, Value, pad, Children
    body = pad4(struct.pack('<HHH', 0, 0, 0) + (key + '\0').encode('utf-16-le'))
    if value:
        body = pad4(body + value)
    for c in children:
        body = pad4(body) + c
    if vlen is None:
        vlen = len(value) // 2 if wtype == 1 else len(value)
    return struct.pack('<HHH', len(body), vlen, wtype) + body[6:]

def vstr(k, v): return vblock(k, (v + '\0').encode('utf-16-le'), 1)

ms, ls = (ver[0] << 16) | ver[1], (ver[2] << 16) | ver[3]
fixed = struct.pack('<13I', 0xFEEF04BD, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0)
verinfo = vblock('VS_VERSION_INFO', fixed, 0, [
    vblock('StringFileInfo', b'', 1, [vblock('040904B0', b'', 1, [vstr(k, v) for k, v in INFO.items()])]),
    vblock('VarFileInfo', b'', 1, [vblock('Translation', struct.pack('<HH', 0x0409, 0x04B0), 0)]),
])

# types (ascending): 3 RT_ICON (ids 1..n), 14 RT_GROUP_ICON, 16 RT_VERSION, 24 RT_MANIFEST
types = [(3, [(i + 1, images[i]) for i in range(n)]), (14, [(1, grp)]), (16, [(1, verinfo)]), (24, [(1, manifest)])]
LANG = 0x0409

def dir_hdr(cnt): return struct.pack('<IIHHHH', 0, 0, 0, 0, 0, cnt)
# compute layout sizes
root_size = 16 + 8 * len(types)
lvl2_sizes = [16 + 8 * len(items) for _, items in types]
lvl3_count = sum(len(items) for _, items in types)
lvl3_size = 16 + 8
off = root_size
lvl2_off = []
for s in lvl2_sizes: lvl2_off.append(off); off += s
lvl3_off = []
for _ in range(lvl3_count): lvl3_off.append(off); off += lvl3_size
data_entry_off = []
for _ in range(lvl3_count): data_entry_off.append(off); off += 16
blobs_start = off

sec = bytearray()
sec += dir_hdr(len(types))
for (tid, _), o in zip(types, lvl2_off): sec += struct.pack('<II', tid, 0x80000000 | o)
k = 0
for (tid, items) in types:
    sec += dir_hdr(len(items))
    for (rid, _) in items:
        sec += struct.pack('<II', rid, 0x80000000 | lvl3_off[k]); k += 1
for i in range(lvl3_count):
    sec += dir_hdr(1) + struct.pack('<II', LANG, data_entry_off[i])
allblobs = [b for _, items in types for _, b in items]
boff, pos = [], blobs_start
for b in allblobs:
    boff.append(pos); pos += (len(b) + 7) & ~7
relocs = []
for i, b in enumerate(allblobs):
    relocs.append(len(sec))
    sec += struct.pack('<IIII', boff[i], len(b), 0, 0)
assert len(sec) == blobs_start
for b in allblobs:
    sec += b + b'\0' * (((len(b) + 7) & ~7) - len(b))

hdr_size = 20 + 40
raw_ptr = hdr_size
rel_ptr = raw_ptr + len(sec)
sym_ptr = rel_ptr + 10 * len(relocs)
coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, sym_ptr, 1, 0, 0)
coff += struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(sec), raw_ptr, rel_ptr, 0, len(relocs), 0, 0x40000040)
coff += bytes(sec)
for r in relocs: coff += struct.pack('<IIH', r, 0, 3)   # IMAGE_REL_AMD64_ADDR32NB
coff += struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 0)
coff += struct.pack('<I', 4)
open(out, 'wb').write(coff)
print('wrote', out, len(coff), 'bytes,', n, 'icon images')
