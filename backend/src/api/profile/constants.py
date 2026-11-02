"""Stable ethnicity IDs shared by the reference endpoint and validation.

Keep assigned IDs unchanged when renaming or reordering choices. Add new choices
with unused positive integer IDs; IDs may grow beyond nine without a schema change.
"""
from types import MappingProxyType


ETHNICITIES = MappingProxyType({
    1: "Aboriginal or Torres Strait Islander",
    2: "Black or African descent",
    3: "Caribbean",
    4: "Central Asian",
    5: "East Asian",
    6: "Hispanic or Latino",
    7: "Indigenous or First Nations",
    8: "Middle Eastern or North African",
    9: "Native American or Alaska Native",
    10: "Pacific Islander",
    11: "South Asian",
    12: "Southeast Asian",
    13: "White or European descent",
    14: "Mixed or multiple ethnicities",
    15: "Other",
    16: "Prefer not to say",
})
