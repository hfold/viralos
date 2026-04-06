import re

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace TAB_COLORS
text = text.replace(
    'const TAB_COLORS = { explorer:"#00ff9d", hook:"#ff6b35", strategy:"#a78bfa", viral:"#f59e0b", competitors:"#38bdf8" };',
    'const TAB_COLORS = { explorer:"var(--acc-green)", hook:"var(--acc-red)", strategy:"var(--acc-purple)", viral:"var(--acc-orange)", competitors:"var(--acc-blue)" };'
)

# Replace glow
old_glow = 'const glow = (c="#00ff9d") => ({ boxShadow:`0 0 20px ${c}22,0 0 40px ${c}11`, border:`1px solid ${c}44` });'
new_glow = '''const glow = (c="var(--acc-green)") => {
  if(c.startsWith("var(--")) {
     const v = c.slice(4, -1);
     return { boxShadow:`0 0 20px rgba(var(${v}-rgb), 0.15), 0 0 40px rgba(var(${v}-rgb), 0.08)`, border:`1px solid rgba(var(${v}-rgb), 0.25)` };
  }
  return { boxShadow:`0 0 20px ${c}22,0 0 40px ${c}11`, border:`1px solid ${c}44` };
};'''
text = text.replace(old_glow, new_glow)

replacements = {
    # Panel Backgrounds
    r'#04080f': 'var(--bg-input)',
    r'#070f1e': 'var(--bg-panel)',
    r'#0a1628': 'var(--bg-input-hover)',
    r'#0d1f3c': 'var(--bg-panel)', 
    r'#0a0816': 'var(--bg-input-hover)',
    r'#0d0a1f': 'var(--bg-panel)',
    r'#1a1035': 'var(--bg-input-hover)',

    # Borders
    r'#1e3a5f': 'var(--border)',
    r'#2a4a6a': 'var(--border-focus)',
    
    # Texts
    r'#111827': 'var(--text-main)', 
    r'#e8f4ff': 'var(--text-main)',
    r'#c8d8f0': 'var(--text-main)',
    r'#e2e8f0': 'var(--text-main)',
    r'#fff': 'var(--text-main)',
    r'#ffffff': 'var(--text-main)',
    r'#7a9bc0': 'var(--text-muted)',
    r'#4a6a8a': 'var(--text-muted)',
    r'#6a5a8a': 'var(--text-muted)',
    r'#8aa8c8': 'var(--text-muted)',
    r'#a3b8cc': 'var(--text-muted)',
    r'#c0d0e0': 'var(--text-muted)',

    # Accents full strings
    r'#00ff9d': 'var(--acc-green)',
    r'#38bdf8': 'var(--acc-blue)',
    r'#a78bfa': 'var(--acc-purple)',
    r'#f59e0b': 'var(--acc-orange)',
    r'#ff6b35': 'var(--acc-red)',
    r'#00e68d': 'var(--acc-green)' # some hover states
}

alpha_reps = {
    r'#00ff9d([0-9a-f]{2})': ('--acc-green-rgb', True),
    r'#38bdf8([0-9a-f]{2})': ('--acc-blue-rgb', True),
    r'#a78bfa([0-9a-f]{2})': ('--acc-purple-rgb', True),
    r'#f59e0b([0-9a-f]{2})': ('--acc-orange-rgb', True),
    r'#ff6b35([0-9a-f]{2})': ('--acc-red-rgb', True),
    r'#1e3a5f([0-9a-f]{2})': ('--border-focus', False),
    r'#a78bfa([0-9a-f]{2})': ('--acc-purple-rgb', True)
}

def hex_to_alpha(hex_2):
    return round(int(hex_2, 16) / 255.0, 2)

for regex_key, rgb_mapping in alpha_reps.items():
    var_name = rgb_mapping[0]
    is_rgb = rgb_mapping[1]
    
    def repl(m):
        alpha_hex = m.group(1)
        if len(alpha_hex) == 2:
            alpha = hex_to_alpha(alpha_hex)
            if is_rgb:
               return f"rgba(var({var_name}), {alpha})"
            else:
               return f"var({var_name})"
        return m.group(0)
    
    text = re.sub(regex_key, repl, text, flags=re.IGNORECASE)

for old, new in replacements.items():
    text = re.sub(old + r'(?![0-9a-fA-F])', new, text, flags=re.IGNORECASE)

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(text)
