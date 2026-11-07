"""Conservative event bot policy; NOT a Python security sandbox.

The actual execution boundary is the separate Docker container, no network or
credentials, read-only root, different child UID, and resource/time limits.
Run this AST pass in the trusted validator parent before importing bot code.
"""

import ast

MAX_BYTES = 32 * 1024
ALLOWED_IMPORTS = {
    "__future__", "melee", "melee.enums", "melee.gamestate", "melee.controller",
    "melee.stages", "melee.framedata", "math", "random", "collections",
    "dataclasses", "enum", "typing",
}
FORBIDDEN_NAMES = {
    "open", "eval", "exec", "compile", "globals", "locals", "vars", "dir",
    "getattr", "setattr", "delattr", "type", "help", "breakpoint", "input",
    "memoryview", "exit", "quit", "get_type_hints", "ForwardRef", "evaluate_forward_ref",
}
FORBIDDEN_ATTRIBUTES = {
    "Console", "Controller", "Logger", "MenuHelper", "connect", "disconnect",
    "flush", "step", "run", "stop", "save_recording", "write", "read", "load",
    "sys", "os", "builtins", "importlib", "modules", "environ", "mro",
    "f_back", "f_globals", "f_locals", "gi_frame", "cr_frame",
    "get_type_hints", "ForwardRef", "evaluate_forward_ref",
}


def root_name(node):
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def check_source(source):
    """Return a parsed tree or raise an actionable ValueError/SyntaxError."""
    if not isinstance(source, str) or not source.strip() or "\0" in source:
        raise ValueError("bot.py must contain nonempty Python text without NUL.")
    if len(source.encode("utf-8")) > MAX_BYTES or len(source.splitlines()) > 2000:
        raise ValueError("Keep bot.py under 32 KiB and 2000 lines.")
    tree = ast.parse(source, filename="bot.py")
    nodes = list(ast.walk(tree))
    imported = set()
    frame_data_names = set()
    for node in nodes:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    raise ValueError(f"Line {node.lineno}: import {alias.name!r} is not allowed; bots must stay offline.")
                imported.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_IMPORTS:
                raise ValueError(f"Line {node.lineno}: only the documented offline imports are allowed.")
            for alias in node.names:
                if alias.name == "*" or alias.name.startswith("_") or alias.name in FORBIDDEN_ATTRIBUTES:
                    raise ValueError(f"Line {node.lineno}: import {alias.name!r} is not allowed.")
                imported.add(alias.asname or alias.name)
                if alias.name == "FrameData":
                    frame_data_names.add(alias.asname or alias.name)

    for node in nodes:
        line = getattr(node, "lineno", 1)
        if isinstance(node, ast.Name) and (node.id.startswith("__") or node.id in FORBIDDEN_NAMES):
            raise ValueError(f"Line {line}: {node.id!r} is not allowed in an event bot.")
        if isinstance(node, ast.Attribute):
            own_private = isinstance(node.value, ast.Name) and node.value.id == "self" and not node.attr.startswith("__")
            if (node.attr.startswith("_") and not own_private) or node.attr in FORBIDDEN_ATTRIBUTES:
                raise ValueError(f"Line {line}: attribute {node.attr!r} is not allowed; use the supplied game/controller API.")
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name.startswith("__") and node.name != "__init__":
            raise ValueError(f"Line {line}: custom dunder definitions are not allowed.")
        if isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.AsyncFor, ast.AsyncWith, ast.Global, ast.Nonlocal)):
            raise ValueError(f"Line {line}: use ordinary synchronous functions and self for bot state.")
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Delete)):
            targets = node.targets if isinstance(node, (ast.Assign, ast.Delete)) else [node.target]
            for target in targets:
                for part in ast.walk(target):
                    if isinstance(part, (ast.Name, ast.Attribute, ast.Subscript)) and isinstance(getattr(part, "ctx", None), (ast.Store, ast.Del)):
                        name = root_name(part)
                        if name in imported or name in {"gamestate", "controller"}:
                            raise ValueError(f"Line {line}: do not modify imported modules, game state, or controller internals.")
        if isinstance(node, ast.Call) and (
            isinstance(node.func, ast.Attribute) and node.func.attr == "FrameData"
            or isinstance(node.func, ast.Name) and node.func.id in frame_data_names
        ):
            if node.args or any(keyword.arg != "write" or not isinstance(keyword.value, ast.Constant) or keyword.value.value is not False for keyword in node.keywords):
                raise ValueError(f"Line {line}: FrameData must be read-only: melee.FrameData() or write=False.")

    bots = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Bot"]
    if len(bots) != 1:
        raise ValueError("Define exactly one top-level class Bot.")
    methods = {node.name for node in bots[0].body if isinstance(node, ast.FunctionDef)}
    if not {"__init__", "get_character", "act"}.issubset(methods):
        raise ValueError("Bot must define __init__(self, port), get_character(self), and act(self, gamestate, controller).")
    return tree
