# Tied Selection Range Matching

The Machines & Inventory product filter now interprets planogram values such as `100-101`, `104 - 105`, and `106–109` as tied selection ranges representing one product location.

- The planogram row remains one selection/product location.
- PAR, maximum, current, and selection count are counted once per planogram row.
- A Machine Log event matches when its individual selection falls within the planogram range.
- Examples: event 104 matches 104-105; event 108 matches 106-109.
- Single selections continue to match normally.
