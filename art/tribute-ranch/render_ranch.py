# お貢ぎ牧場の牧場経営（設計書16.8）: 牧場の絵を Blender で描く。
# やわらかい箱庭の絵柄（輪郭線なし・やわらかい影・暖かい日差し・パステル寄り・丸いおもちゃのような動物）。
#
#   blender -b --factory-startup -P art/tribute-ranch/render_ranch.py -- <出力フォルダ> <day|evening|night|layout>
#
# 1回の実行で、その時間帯の絵をすべて描く。
#   ranch-lv{1..30}-{時間帯}.webp   芝の島と、そのレベルまでの施設（背景は透明。空は画面側で描く）
#   {cow|pig|sheep|goat|chicken|rabbit}-{stand|walk1|walk2|eat|sleep}[-t{1..4}]-{時間帯}.webp   動物（足元が絵の決まった位置に来る）。-t は、なつきの飾り
#   prop-{letter|hay|stake}-{時間帯}.webp   小物
# layout を渡すと、何も描かずに、動物の立ち位置と足元の位置を画面の割合で書き出す（tribute-core.mjs に写す）。
import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
TIME = argv[1] if len(argv) > 1 else "day"
LAYOUT_ONLY = TIME == "layout"
# 確かめる時だけ: RANCH_LEVELS="10,20,30" で描くレベルを絞り（"0" で背景を描かない）、RANCH_SPRITES="cow-stand" で描く動物としぐさを絞る（"goat" のように動物だけでもよい）。
ONLY_LEVELS = {int(value) for value in os.environ.get("RANCH_LEVELS", "").split(",") if value.strip()}
ONLY_SPRITES = {value.strip() for value in os.environ.get("RANCH_SPRITES", "").split(",") if value.strip()}
if LAYOUT_ONLY:
    TIME = "day"

SCENE_W, SCENE_H = 960, 600
SCENE_ORTHO = 12.0
SPRITE_PX = 256
SPRITE_ORTHO = 2.9
CAMERA_DIR = Vector((-11, 11, -9.2)).normalized()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue

MATS = {}


def mat(name, color, rough=0.55, sheen=0.0, noise=None, emission=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    if noise:
        color2, scale = noise
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = scale
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = (*color, 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*color2, 1)
        links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    MATS[name] = m
    return m


# 夜は窓の灯りを強める（昼は弱い光）。
WINDOW_GLOW = {"day": 0.0, "evening": 1.5, "night": 4.0}[TIME]


def finish(obj, material, smooth=True):
    obj.data.materials.append(material)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def link(obj, parent, group):
    if parent:
        obj.parent = parent
    if group is not None:
        group.append(obj)
    return obj


def sphere(loc, scale, material, parent=None, group=None, seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, location=loc)
    obj = bpy.context.active_object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    finish(obj, material)
    return link(obj, parent, group)


def rcyl(loc, radius, depth, material, rot=(0, 0, 0), parent=None, group=None, vertices=24, round_ratio=0.45):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = min(radius, depth) * round_ratio
    bev.segments = 5
    finish(obj, material)
    return link(obj, parent, group)


def rcube(loc, size, material, rot=(0, 0, 0), parent=None, group=None, round_width=0.06):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = round_width
    bev.segments = 5
    finish(obj, material)
    return link(obj, parent, group)


def rcone(loc, r1, depth, material, rot=(0, 0, 0), parent=None, group=None, tip=0.25, vertices=20):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r1 * tip, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = r1 * 0.25
    bev.segments = 4
    finish(obj, material)
    return link(obj, parent, group)


def mesh_object(name, verts, faces, material, group):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, material, smooth=False)
    return link(obj, None, group)


def empty(loc, rot=(0, 0, 0), parent=None, group=None):
    bpy.ops.object.empty_add(location=loc, rotation=rot)
    return link(bpy.context.active_object, parent, group)


# ───────────── 動物 ─────────────
# しぐさ: stand（立つ）・walk1/walk2（歩く2コマ）・eat（頭を下げて食べる）・sleep（伏せて眠る）。
# 足元は原点。顔は +x を向く（向きは置く時に回す）。

def face(head, r, group, closed=False, spread=0.34, height=0.08):
    black = mat("eye", (0.04, 0.03, 0.04), 0.15)
    shine = mat("shine", (1, 1, 1), 0.2, emission=2.0)
    cheek = mat("cheek", (1.0, 0.55, 0.62), 0.8)
    for side in (-1, 1):
        x = r * 0.9
        y = side * r * spread
        z = r * height
        if closed:
            # 閉じた目: 細い横線
            rcube((x, y, z - 0.01), (0.012, 0.07, 0.012), black, parent=head, group=group, round_width=0.01)
        else:
            sphere((x, y, z), (0.05, 0.075, 0.095), black, head, group, seg=16)
            sphere((x + 0.04, y + 0.02, z + 0.035), (0.02, 0.022, 0.022), shine, head, group, seg=8)
        sphere((r * 0.8, side * r * 0.62, -r * 0.2), (0.04, 0.1, 0.06), cheek, head, group, seg=12)


def legs(root, group, sx, sy, color, hoof, height, pose):
    if pose == "sleep":
        # 伏せている時は、脚を体の下にたたんで見せない
        return
    for ix in (-1, 1):
        for iy in (-1, 1):
            lift = 0.0
            if pose in ("walk1", "walk2"):
                # 対角の2本ずつ、交互に持ち上げる（正面に近い向きでも歩いて見えるように）
                lift = 0.1 if (ix == iy) == (pose == "walk1") else 0.0
            pivot = empty((ix * sx, iy * sy, height + 0.03 + lift), parent=root, group=group)
            rcyl((0, 0, -height / 2), 0.14, height, color, parent=pivot, group=group)
            rcyl((0, 0, -height + 0.03), 0.145, 0.12, hoof, parent=pivot, group=group)


def head_pivot(root, group, neck, pose):
    """頭の付け根。食べる時は頭を下げて少し前へ、眠る時は少し下げる。"""
    x, y, z = neck
    if pose == "eat":
        return empty((x + 0.1, y, z - 0.34), rot=(0, math.radians(18), 0), parent=root, group=group)
    if pose == "sleep":
        return empty((x, y, z - 0.08), rot=(0, math.radians(8), 0), parent=root, group=group)
    return empty(neck, parent=root, group=group)


def body_lift(pose):
    """体の高さ。歩く時は少し弾み、眠る時は伏せる。"""
    return {"sleep": -0.22, "walk1": 0.05, "walk2": 0.0}.get(pose, 0.0)


# なつき（設計書16、財布が通算で仕えた日数）で増える飾り。
# 1: 鈴（首輪と金の鈴） 2: リボン 3: 花かんむり 4: 金の王冠（花かんむりの代わり）。
FONDNESS_TIERS = (0, 1, 2, 3, 4)


def fondness(body, head, group, tier, collar, bell, ribbon, top, head_r):
    if tier >= 1:
        (cx, cy, cz), radius = collar
        rcyl((cx, cy, cz), radius, 0.08, mat("collar", (0.98, 0.42, 0.62), 0.45), rot=(0, math.radians(68), 0), parent=body, group=group)
        sphere(bell, (0.12, 0.12, 0.12), mat("bell", (1.0, 0.8, 0.35), 0.25), body, group)
    if tier >= 2:
        pink = mat("ribbon", (1.0, 0.45, 0.66), 0.45)
        x, y, z = ribbon
        for side in (-1, 1):
            sphere((x, y + side * 0.13, z + 0.02), (0.07, 0.12, 0.08), pink, head, group, seg=16)
        sphere((x, y, z), (0.06, 0.06, 0.06), pink, head, group, seg=12)
    if tier == 3:
        colors = [(1.0, 0.62, 0.74), (1.0, 0.92, 0.5), (0.8, 0.7, 1.0), (1.0, 1.0, 1.0)]
        ring = head_r * 0.42
        for k in range(8):
            a = 2 * math.pi * k / 8
            sphere((-0.04 + ring * math.cos(a), ring * math.sin(a), top), (0.075, 0.075, 0.06), mat(f"crown_flower{k % 4}", colors[k % 4], 0.5), head, group, seg=12)
        sphere((-0.04, 0, top - 0.02), (ring * 0.8, ring * 0.8, 0.05), mat("leaf", (0.2, 0.58, 0.26), 0.7), head, group, seg=16)
    if tier >= 4:
        gold = mat("crown_gold", (1.0, 0.8, 0.32), 0.18)
        jewel = mat("crown_jewel", (1.0, 0.3, 0.55), 0.15)
        radius = head_r * 0.36
        rcyl((-0.04, 0, top + 0.02), radius, 0.14, gold, parent=head, group=group, vertices=24, round_ratio=0.2)
        for k in range(5):
            a = 2 * math.pi * k / 5
            rcone((-0.04 + radius * 0.95 * math.cos(a), radius * 0.95 * math.sin(a), top + 0.16), 0.06, 0.16, gold, parent=head, group=group, tip=0.2, vertices=8)
        sphere((-0.04 + radius, 0, top + 0.03), (0.04, 0.04, 0.04), jewel, head, group, seg=10)


def cow(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    white = mat("cow_white", (0.97, 0.95, 0.92), 0.6, sheen=0.3)
    patch = mat("cow_patch", (0.33, 0.25, 0.22), 0.6)
    muzzle = mat("cow_muzzle", (1.0, 0.76, 0.76), 0.5)
    horn = mat("horn", (1.0, 0.92, 0.72), 0.4)
    hoof = mat("hoof", (0.5, 0.36, 0.3), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.78), (0.82, 0.62, 0.55), white, body, group)
    sphere((0.05, -0.5, 0.95), (0.3, 0.16, 0.24), patch, body, group)
    sphere((-0.45, 0.42, 0.9), (0.24, 0.24, 0.2), patch, body, group)
    legs(body, group, 0.42, 0.3, white, hoof, 0.34, pose)
    neck = head_pivot(body, group, (0.55, 0, 1.0), pose)
    head = empty((0.23, 0, 0.3), parent=neck, group=group)
    sphere((0, 0, 0), (0.62, 0.62, 0.56), white, head, group)
    sphere((0.42, 0, -0.18), (0.26, 0.4, 0.22), muzzle, head, group)
    for side in (-1, 1):
        sphere((0.66, side * 0.13, -0.15), (0.025, 0.05, 0.035), mat("nostril", (0.7, 0.4, 0.42)), head, group, seg=8)
        rcone((-0.08, side * 0.38, 0.6), 0.08, 0.26, horn, rot=(side * -0.45, 0, 0), parent=head, group=group)
        sphere((-0.12, side * 0.7, 0.2), (0.13, 0.26, 0.08), white, head, group)
        sphere((-0.09, side * 0.71, 0.2), (0.08, 0.17, 0.04), muzzle, head, group)
    face(head, 0.62, group, closed=pose == "sleep")
    fondness(body, head, group, tier, collar=((0.9, 0, 0.93), 0.36), bell=(0.92, 0, 0.82), ribbon=(-0.12, 0.6, 0.42), top=0.62, head_r=0.62)
    return root


def pig(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    skin = mat("pig_skin", (1.0, 0.62, 0.7), 0.55, sheen=0.2)
    snout = mat("pig_snout", (1.0, 0.52, 0.62), 0.5)
    hoof = mat("pig_hoof", (0.75, 0.45, 0.5), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.7), (0.74, 0.62, 0.55), skin, body, group)
    legs(body, group, 0.36, 0.28, skin, hoof, 0.3, pose)
    neck = head_pivot(body, group, (0.45, 0, 0.85), pose)
    head = empty((0.23, 0, 0.27), parent=neck, group=group)
    sphere((0, 0, 0), (0.6, 0.6, 0.55), skin, head, group)
    rcyl((0.57, 0, -0.12), 0.2, 0.18, snout, rot=(0, math.radians(90), 0), parent=head, group=group)
    for side in (-1, 1):
        sphere((0.67, side * 0.07, -0.12), (0.02, 0.035, 0.055), mat("pig_nostril", (0.6, 0.28, 0.35)), head, group, seg=8)
        rcone((-0.13, side * 0.38, 0.54), 0.17, 0.26, skin, rot=(side * -0.3, 0.35, 0), parent=head, group=group)
    face(head, 0.6, group, closed=pose == "sleep")
    fondness(body, head, group, tier, collar=((0.74, 0, 0.62), 0.36), bell=(0.98, 0.05, 0.5), ribbon=(-0.1, 0.46, 0.5), top=0.56, head_r=0.6)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.035, location=(-0.76, 0, 0.88), rotation=(0, math.radians(90), 0))
    link(finish(bpy.context.active_object, skin), body, group)
    return root


def sheep(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    wool = mat("wool", (1.0, 0.98, 0.95), 0.9, sheen=0.6)
    skin = mat("sheep_face", (0.92, 0.8, 0.7), 0.55)
    hoof = mat("sheep_hoof", (0.45, 0.35, 0.32), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    for x, y, z, r in [
        (0, 0, 0.8, 0.52), (0.3, 0.24, 0.85, 0.36), (0.3, -0.24, 0.85, 0.36), (-0.32, 0.24, 0.82, 0.36),
        (-0.32, -0.24, 0.82, 0.36), (0, 0.36, 0.76, 0.33), (0, -0.36, 0.76, 0.33), (0.05, 0, 1.13, 0.36), (-0.3, 0, 1.06, 0.32),
    ]:
        sphere((x, y, z), (r, r, r * 0.92), wool, body, group, seg=24)
    legs(body, group, 0.3, 0.22, skin, hoof, 0.32, pose)
    neck = head_pivot(body, group, (0.4, 0, 0.95), pose)
    head = empty((0.2, 0, 0.23), parent=neck, group=group)
    sphere((0, 0, 0), (0.42, 0.4, 0.42), skin, head, group)
    for dx, dy in [(-0.05, 0), (-0.02, 0.18), (-0.02, -0.18), (-0.15, 0.08), (-0.15, -0.08)]:
        sphere((dx, dy, 0.34), (0.16, 0.16, 0.13), wool, head, group, seg=16)
    for side in (-1, 1):
        sphere((-0.08, side * 0.46, 0.07), (0.1, 0.2, 0.06), skin, head, group)
    face(head, 0.42, group, closed=pose == "sleep", spread=0.4)
    fondness(body, head, group, tier, collar=((0.62, 0, 0.9), 0.27), bell=(0.68, 0, 0.78), ribbon=(-0.06, 0.4, 0.3), top=0.5, head_r=0.42)
    return root


# 第2段で増やした動物（やぎ・にわとり・うさぎ）。
def goat(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    coat = mat("goat_coat", (0.86, 0.64, 0.44), 0.65, sheen=0.3)
    cream = mat("goat_cream", (1.0, 0.95, 0.86), 0.6, sheen=0.3)
    muzzle = mat("goat_muzzle", (1.0, 0.8, 0.76), 0.5)
    horn = mat("goat_horn", (0.9, 0.84, 0.72), 0.4)
    hoof = mat("goat_hoof", (0.42, 0.33, 0.3), 0.5)
    lift = body_lift(pose)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.82), (0.7, 0.5, 0.48), coat, body, group)
    sphere((0.18, 0, 0.66), (0.46, 0.4, 0.3), cream, body, group)
    rcone((-0.66, 0, 1.02), 0.1, 0.24, cream, rot=(0, math.radians(-50), 0), parent=body, group=group)
    legs(body, group, 0.36, 0.24, coat, hoof, 0.4, pose)
    neck = head_pivot(body, group, (0.5, 0, 1.08), pose)
    head = empty((0.2, 0, 0.32), parent=neck, group=group)
    sphere((0, 0, 0), (0.48, 0.44, 0.46), coat, head, group)
    sphere((0.32, 0, -0.14), (0.22, 0.27, 0.2), cream, head, group)
    sphere((0.5, 0, -0.1), (0.04, 0.07, 0.04), muzzle, head, group, seg=10)
    rcone((0.34, 0, -0.44), 0.09, 0.34, mat("goat_beard", (0.62, 0.44, 0.3), 0.7), rot=(math.pi, 0, 0), parent=head, group=group, tip=0.15)
    for side in (-1, 1):
        rcone((-0.16, side * 0.17, 0.52), 0.075, 0.44, horn, rot=(side * -0.12, math.radians(-55), 0), parent=head, group=group, tip=0.15)
        sphere((-0.06, side * 0.5, 0.08), (0.1, 0.22, 0.06), coat, head, group)
        sphere((-0.03, side * 0.52, 0.08), (0.06, 0.15, 0.03), muzzle, head, group)
    face(head, 0.46, group, closed=pose == "sleep", spread=0.36)
    fondness(body, head, group, tier, collar=((0.86, 0, 0.92), 0.26), bell=(0.92, -0.12, 0.8), ribbon=(-0.08, 0.36, 0.3), top=0.46, head_r=0.46)
    return root


def chicken(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    feather = mat("hen_feather", (1.0, 0.98, 0.94), 0.75, sheen=0.4)
    comb = mat("hen_comb", (0.96, 0.32, 0.32), 0.45)
    beak = mat("hen_beak", (1.0, 0.74, 0.28), 0.4)
    foot = mat("hen_foot", (1.0, 0.7, 0.32), 0.5)
    lift = {"sleep": -0.18, "walk1": 0.05, "walk2": 0.0}.get(pose, 0.0)
    body = empty((0, 0, lift), parent=root, group=group)
    sphere((0, 0, 0.7), (0.58, 0.5, 0.5), feather, body, group)
    for y in (-0.13, 0, 0.13):
        rcone((-0.55, y, 1.0), 0.13, 0.5, feather, rot=(-y * 2.2, math.radians(-34), 0), parent=body, group=group, tip=0.3)
    for side in (-1, 1):
        sphere((-0.04, side * 0.47, 0.72), (0.36, 0.1, 0.25), feather, body, group)
    if pose != "sleep":
        # 脚は2本。歩く時は交互に持ち上げる
        for side in (-1, 1):
            step = 0.1 if (pose == "walk1") == (side < 0) and pose in ("walk1", "walk2") else 0.0
            pivot = empty((0.06, side * 0.2, 0.3 + step), parent=body, group=group)
            rcyl((0, 0, -0.15), 0.05, 0.3, foot, parent=pivot, group=group, round_ratio=0.3)
            sphere((0.08, 0, -0.29), (0.15, 0.09, 0.03), foot, pivot, group, seg=12)
    if pose == "eat":
        # ついばむ: 頭を前に低く下げる
        neck = empty((0.55, 0, 0.55), rot=(0, math.radians(35), 0), parent=body, group=group)
    else:
        neck = head_pivot(body, group, (0.3, 0, 1.05), pose)
    head = empty((0.08, 0, 0.2), parent=neck, group=group)
    sphere((0, 0, 0), (0.36, 0.34, 0.36), feather, head, group)
    for x, z, r in [(-0.12, 0.34, 0.08), (0.0, 0.4, 0.1), (0.12, 0.35, 0.08)]:
        sphere((x, 0, z), (r, 0.05, r * 1.1), comb, head, group, seg=16)
    rcone((0.38, 0, -0.02), 0.08, 0.18, beak, rot=(0, math.radians(90), 0), parent=head, group=group, tip=0.15)
    sphere((0.3, 0, -0.18), (0.05, 0.04, 0.08), comb, head, group, seg=12)
    face(head, 0.36, group, closed=pose == "sleep", spread=0.42, height=0.12)
    # 首輪と鈴は首につける（ついばむ時も頭と一緒に動く）
    fondness(neck, head, group, tier, collar=((0.1, 0, -0.05), 0.22), bell=(0.27, 0, -0.17), ribbon=(-0.1, 0.24, 0.26), top=0.38, head_r=0.36)
    return root


def rabbit(pose, group, tier=0):
    root = empty((0, 0, 0), group=group)
    fur = mat("rabbit_fur", (0.8, 0.78, 0.84), 0.75, sheen=0.5)
    white = mat("rabbit_white", (1.0, 0.97, 0.94), 0.75, sheen=0.4)
    pink = mat("rabbit_pink", (1.0, 0.7, 0.75), 0.6)
    nose = mat("rabbit_nose", (0.95, 0.5, 0.58), 0.4)
    # 歩く時は跳ねる（1コマ目は宙、2コマ目は着地して少しつぶれる）
    lift = {"sleep": -0.06, "walk1": 0.2, "walk2": 0.0}.get(pose, 0.0)
    body = empty((0, 0, lift), parent=root, group=group)
    if pose == "walk2":
        body.scale = (1.06, 1.06, 0.92)
    sphere((-0.05, 0, 0.55), (0.6, 0.48, 0.48), fur, body, group)
    sphere((0.3, 0, 0.45), (0.3, 0.3, 0.3), white, body, group)
    sphere((-0.64, 0, 0.7), (0.16, 0.16, 0.16), white, body, group, seg=16)
    for side in (-1, 1):
        sphere((0.36, side * 0.2, 0.08), (0.14, 0.08, 0.08), fur, body, group, seg=16)
        sphere((-0.25, side * 0.33, 0.08), (0.26, 0.11, 0.08), fur, body, group, seg=16)
    neck = head_pivot(body, group, (0.35, 0, 0.86), pose)
    head = empty((0.12, 0, 0.22), parent=neck, group=group)
    sphere((0, 0, 0), (0.42, 0.42, 0.4), fur, head, group)
    sphere((0.32, 0, -0.12), (0.15, 0.21, 0.12), white, head, group)
    sphere((0.45, 0, -0.05), (0.04, 0.06, 0.04), nose, head, group, seg=10)
    for side in (-1, 1):
        lean = -1.25 if pose == "sleep" else -0.15
        ear = empty((-0.06, side * 0.15, 0.3), rot=(side * -0.22, lean, 0), parent=head, group=group)
        sphere((0, 0, 0.36), (0.1, 0.13, 0.4), fur, ear, group)
        sphere((0.06, 0, 0.36), (0.05, 0.08, 0.3), pink, ear, group, seg=16)
    face(head, 0.42, group, closed=pose == "sleep", spread=0.36)
    fondness(body, head, group, tier, collar=((0.42, 0, 0.84), 0.25), bell=(0.58, 0, 0.72), ribbon=(-0.04, 0.3, 0.3), top=0.4, head_r=0.42)
    return root


ANIMALS = {"cow": cow, "pig": pig, "sheep": sheep, "goat": goat, "chicken": chicken, "rabbit": rabbit}
POSES = ("stand", "walk1", "walk2", "eat", "sleep")


# ───────────── 小物 ─────────────

def prop_letter(group):
    # 見る人の方へ向けた封筒（桃色の封蝋つき）
    root = empty((0, 0, 0.9), rot=(0, 0, math.radians(-45)), group=group)
    rcube((0, 0, 0), (0.05, 0.42, 0.3), mat("paper", (1.0, 0.98, 0.94), 0.5), parent=root, group=group, round_width=0.03)
    sphere((0.06, 0, 0.02), (0.03, 0.09, 0.08), mat("seal_pink", (0.98, 0.36, 0.56), 0.35), root, group, seg=16)
    return root


def prop_hay(group):
    root = empty((0, 0, 0), group=group)
    hay = mat("hay", (0.98, 0.84, 0.42), 0.8, noise=((0.9, 0.74, 0.34), 14))
    for x, y, z, r in [(0, 0, 0.18, 0.36), (0.22, 0.15, 0.14, 0.25), (-0.2, -0.12, 0.14, 0.24), (0.05, -0.22, 0.12, 0.22), (-0.05, 0.05, 0.38, 0.2)]:
        sphere((x, y, z), (r, r, r * 0.75), hay, root, group, seg=16)
    return root


def prop_stake(group):
    root = empty((0, 0, 0), group=group)
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    rcyl((0, 0, 0.45), 0.09, 0.9, wood, parent=root, group=group)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.03, location=(0, 0, 0.62))
    link(finish(bpy.context.active_object, mat("rope", (0.95, 0.5, 0.62), 0.6)), root, group)
    return root


PROPS = {"letter": prop_letter, "hay": prop_hay, "stake": prop_stake}


# ───────────── 芝の島と施設 ─────────────

def tree(loc, scale, group):
    trunk = mat("trunk", (0.6, 0.42, 0.3), 0.75, noise=((0.52, 0.36, 0.26), 12))
    leaf = mat("leaf", (0.2, 0.58, 0.26), 0.7, sheen=0.2, noise=((0.16, 0.5, 0.22), 4))
    x, y, z = loc
    rcyl((x, y, z + 0.6 * scale), 0.2 * scale, 1.2 * scale, trunk, group=group)
    for dx, dy, dz, r in [(0, 0, 1.65, 0.75), (0.35, 0.2, 1.4, 0.55), (-0.35, -0.15, 1.45, 0.55), (0.05, -0.3, 2.05, 0.5), (-0.1, 0.32, 1.95, 0.5)]:
        sphere((x + dx * scale, y + dy * scale, z + dz * scale), (r * scale, r * scale, r * scale * 0.9), leaf, group=group, seg=24)


def island(group):
    grass = mat("grass", (0.36, 0.7, 0.24), 0.85, noise=((0.3, 0.62, 0.2), 3.5))
    soil = mat("soil", (0.62, 0.42, 0.26), 0.9, noise=((0.55, 0.36, 0.22), 6))
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=4.4, depth=0.6, location=(0, 0, -0.3))
    ground = bpy.context.active_object
    ground.scale = (1.3, 1.0, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    bev = ground.modifiers.new("round", "BEVEL")
    bev.width = 0.25
    bev.segments = 8
    link(finish(ground, soil, smooth=False), None, group)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=4.35, depth=0.12, location=(0, 0, 0.0))
    top = bpy.context.active_object
    top.scale = (1.3, 1.0, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    bev = top.modifiers.new("round", "BEVEL")
    bev.width = 0.06
    bev.segments = 6
    link(finish(top, grass), None, group)
    bush = mat("bush", (0.26, 0.6, 0.24), 0.8, sheen=0.2)
    for x, y in [(-5.0, -1.0), (5.2, -1.2), (-2.0, -3.4)]:
        sphere((x, y, 0.2), (0.35, 0.3, 0.28), bush, group=group, seg=20)
    colors = [(1.0, 0.6, 0.72), (1.0, 0.88, 0.45), (0.78, 0.66, 1.0), (1.0, 1.0, 1.0)]
    for i, (x, y) in enumerate([(-3.8, 0.4), (-2.4, 2.0), (2.6, 2.0), (3.4, -0.4), (0.6, 3.0), (-0.4, -3.2), (4.6, 0.4), (1.0, -3.0)]):
        sphere((x, y, 0.12), (0.1, 0.1, 0.07), mat(f"flower{i % 4}", colors[i % 4], 0.5), group=group, seg=12)
        sphere((x, y, 0.17), (0.04, 0.04, 0.03), mat("flower_center", (1.0, 0.85, 0.3), 0.5), group=group, seg=8)
    tree((4.6, 1.6, 0), 0.85, group)


def left_tree(group):
    tree((-2.6, 3.3, 0), 1.0, group)


def fence(group):
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    for i in range(5):
        rcyl((-3.6 + i * 1.25, -2.85, 0.42), 0.11, 0.8, wood, group=group)
    for z in (0.36, 0.66):
        rcube((-1.1, -2.85, z), (2.6, 0.06, 0.06), wood, group=group, round_width=0.05)


def trough(group):
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    water = mat("water", (0.45, 0.78, 0.95), 0.1)
    rcube((-3.0, -1.7, 0.17), (0.55, 0.28, 0.16), wood, group=group, round_width=0.07)
    rcube((-3.0, -1.7, 0.34), (0.44, 0.18, 0.03), water, group=group, round_width=0.02)


def hut(group):
    wall = mat("hut_wall", (1.0, 0.93, 0.8), 0.7)
    roof = mat("hut_roof", (0.95, 0.45, 0.45), 0.55)
    door = mat("hut_door", (0.62, 0.42, 0.3), 0.7)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    x, y = -4.3, 1.4
    rcube((x, y, 0.5), (0.65, 0.55, 0.5), wall, group=group, round_width=0.08)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.05, radius2=0, depth=0.75, location=(x, y, 1.35), rotation=(0, 0, math.radians(45)))
    r = bpy.context.active_object
    bev = r.modifiers.new("round", "BEVEL")
    bev.width = 0.08
    bev.segments = 4
    link(finish(r, roof, smooth=False), None, group)
    rcube((x + 0.66, y - 0.15, 0.36), (0.02, 0.18, 0.3), door, group=group, round_width=0.02)
    rcube((x + 0.66, y + 0.28, 0.6), (0.02, 0.12, 0.12), window, group=group, round_width=0.02)


def flower_bed(group):
    soil = mat("bed_soil", (0.55, 0.36, 0.24), 0.9)
    colors = [(1.0, 0.5, 0.66), (1.0, 0.86, 0.36), (0.72, 0.6, 1.0), (1.0, 0.98, 0.98), (1.0, 0.62, 0.42)]
    cx, cy = 3.7, -1.5
    rcyl((cx, cy, 0.08), 0.85, 0.14, soil, group=group, vertices=32)
    i = 0
    for ring, count in ((0.0, 1), (0.35, 6), (0.65, 10)):
        for k in range(count):
            a = 2 * math.pi * k / max(count, 1)
            x = cx + ring * math.cos(a)
            y = cy + ring * math.sin(a) * 0.8
            rcyl((x, y, 0.28), 0.025, 0.3, mat("stem", (0.3, 0.62, 0.3), 0.7), group=group, vertices=8)
            sphere((x, y, 0.46), (0.11, 0.11, 0.09), mat(f"bed_flower{i % 5}", colors[i % 5], 0.5), group=group, seg=12)
            i += 1


def windmill(group):
    wall = mat("mill_wall", (0.98, 0.95, 0.9), 0.7)
    roof = mat("mill_roof", (0.55, 0.62, 0.95), 0.55)
    blade = mat("mill_blade", (1.0, 0.98, 0.96), 0.6)
    x, y = 4.9, -0.4
    rcone((x, y, 1.0), 0.55, 2.0, wall, group=group, tip=0.7)
    rcone((x, y, 2.25), 0.5, 0.6, roof, group=group, tip=0.05)
    hub = empty((x - 0.45, y - 0.45, 1.75), rot=(0, 0, math.radians(-45)), group=group)
    sphere((0, 0, 0), (0.1, 0.1, 0.1), roof, hub, group, seg=12)
    for k in range(4):
        arm = empty((0, 0, 0), rot=(math.radians(90 * k + 20), 0, 0), parent=hub, group=group)
        rcube((0.05, 0, 0.55), (0.02, 0.14, 0.5), blade, parent=arm, group=group, round_width=0.02)


def pond(group):
    edge = mat("pond_edge", (0.86, 0.82, 0.76), 0.8)
    water = mat("pond_water", (0.4, 0.74, 0.95), 0.08)
    lily = mat("lily", (0.3, 0.7, 0.35), 0.6)
    cx, cy = 1.9, -2.7
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.95, depth=0.1, location=(cx, cy, 0.06))
    p = bpy.context.active_object
    p.scale = (1.3, 0.85, 1)
    bpy.ops.object.transform_apply(scale=True)
    link(finish(p, water), None, group)
    for k in range(14):
        a = 2 * math.pi * k / 14
        sphere((cx + 1.3 * 0.98 * math.cos(a), cy + 0.85 * 0.98 * math.sin(a), 0.1), (0.16, 0.16, 0.1), edge, group=group, seg=12)
    for dx, dy in ((0.3, 0.1), (-0.4, -0.15)):
        rcyl((cx + dx, cy + dy, 0.13), 0.16, 0.02, lily, group=group, vertices=16)


def barn(group):
    wall = mat("barn_wall", (0.92, 0.4, 0.38), 0.65)
    trim = mat("barn_trim", (1.0, 0.97, 0.92), 0.6)
    roof = mat("barn_roof", (0.45, 0.32, 0.3), 0.6)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    x, y = 0.2, 3.5
    rcube((x, y, 0.75), (1.1, 0.8, 0.75), wall, group=group, round_width=0.08)
    # 切妻: 戸口（+x）の面に三角の壁を見せ、棟は x に沿わせる。
    gable = mesh_object("barn_gable", [
        (x - 1.08, y - 0.8, 1.48), (x - 1.08, y + 0.8, 1.48), (x - 1.08, y, 2.2),
        (x + 1.08, y - 0.8, 1.48), (x + 1.08, y + 0.8, 1.48), (x + 1.08, y, 2.2),
    ], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], wall, group)
    gable.modifiers.new("round", "BEVEL").width = 0.03
    roof_obj = mesh_object("barn_roof", [
        (x - 1.25, y, 2.28), (x + 1.25, y, 2.28),
        (x - 1.25, y - 1.0, 1.4), (x + 1.25, y - 1.0, 1.4),
        (x - 1.25, y + 1.0, 1.4), (x + 1.25, y + 1.0, 1.4),
    ], [(0, 1, 3, 2), (0, 4, 5, 1)], roof, group)
    thick = roof_obj.modifiers.new("thick", "SOLIDIFY")
    thick.thickness = 0.1
    roof_obj.modifiers.new("round", "BEVEL").width = 0.03
    rcube((x + 1.11, y, 0.5), (0.02, 0.38, 0.48), trim, group=group, round_width=0.02)
    rcube((x + 1.12, y, 0.5), (0.02, 0.3, 0.4), mat("barn_door", (0.8, 0.32, 0.3), 0.7), group=group, round_width=0.02)
    rcube((x + 1.1, y, 1.75), (0.02, 0.16, 0.14), window, group=group, round_width=0.02)


def clock_tower(group):
    wall = mat("tower_wall", (1.0, 0.95, 0.86), 0.65)
    roof = mat("tower_roof", (0.36, 0.6, 0.5), 0.55)
    face_m = mat("clock_face", (1.0, 1.0, 0.97), 0.4, emission=WINDOW_GLOW * 0.4)
    hand = mat("clock_hand", (0.25, 0.2, 0.2), 0.4)
    x, y = -5.0, -0.1
    rcube((x, y, 1.2), (0.42, 0.42, 1.2), wall, group=group, round_width=0.08)
    rcone((x, y, 2.75), 0.62, 0.9, roof, group=group, tip=0.05, vertices=4)
    clock = empty((x + 0.43, y, 1.85), rot=(0, math.radians(90), 0), group=group)
    rcyl((0, 0, 0), 0.28, 0.05, face_m, parent=clock, group=group, vertices=32)
    rcube((0.0, 0.0, 0.04), (0.03, 0.015, 0.16), hand, parent=clock, group=group, round_width=0.01)
    rcube((0.08, 0.0, 0.04), (0.11, 0.015, 0.03), hand, parent=clock, group=group, round_width=0.01)


def golden_statue(group):
    gold = mat("gold", (1.0, 0.78, 0.3), 0.18)
    stone = mat("pedestal", (0.9, 0.88, 0.84), 0.7)
    x, y = -1.6, 2.2
    rcyl((x, y, 0.25), 0.55, 0.5, stone, group=group, vertices=32)
    holder = empty((x, y, 0.5), rot=(0, 0, math.radians(-35)), group=group)
    statue = []
    root = cow("stand", statue)
    root.parent = holder
    root.scale = (0.55, 0.55, 0.55)
    for obj in statue:
        # 目と光は残して、ほかを金にする（顔が分かるように）。
        if obj.type == "MESH" and not any(m and m.name in ("eye", "shine") for m in obj.data.materials):
            obj.data.materials.clear()
            obj.data.materials.append(gold)
        group.append(obj)


# ───────────── Lv11〜30 の施設（島が混んでいるので、建物への取り付け・置き換え・空のものが中心） ─────────────

GLOW = max(WINDOW_GLOW, 0.6)


def mailbox(group):
    wood = mat("wood", (0.86, 0.66, 0.46), 0.7, noise=((0.78, 0.58, 0.4), 10))
    red = mat("mailbox_red", (0.95, 0.38, 0.4), 0.45)
    x, y = -3.2, 0.8
    rcyl((x, y, 0.35), 0.05, 0.7, wood, group=group, vertices=12)
    rcube((x, y, 0.78), (0.16, 0.11, 0.12), red, group=group, round_width=0.06)
    rcube((x - 0.02, y + 0.13, 0.86), (0.02, 0.02, 0.08), mat("mailbox_flag", (1.0, 0.85, 0.3), 0.4), group=group, round_width=0.01)


def street_lamps(group):
    pole = mat("lamp_pole", (0.25, 0.32, 0.3), 0.45)
    bulb = mat("lamp_bulb", (1.0, 0.86, 0.55), 0.3, emission=GLOW + 1.0)
    for x in (-3.0, 0.6):
        y = -2.45
        rcyl((x, y, 0.6), 0.05, 1.2, pole, group=group, vertices=12)
        rcone((x, y, 1.32), 0.17, 0.16, pole, group=group, tip=0.3, vertices=12)
        sphere((x, y, 1.2), (0.12, 0.12, 0.12), bulb, group=group, seg=14)


def weathervane(group):
    iron = mat("vane_iron", (0.3, 0.3, 0.34), 0.4)
    gold = mat("crown_gold", (1.0, 0.8, 0.32), 0.18)
    x, y, z = 0.2, 3.5, 2.3
    rcyl((x, y, z + 0.3), 0.03, 0.6, iron, group=group, vertices=8)
    rcube((x, y, z + 0.5), (0.3, 0.02, 0.02), iron, group=group, round_width=0.01)
    sphere((x + 0.05, y, z + 0.72), (0.14, 0.05, 0.11), gold, group=group, seg=12)
    sphere((x + 0.17, y, z + 0.82), (0.06, 0.04, 0.06), gold, group=group, seg=10)
    rcone((x - 0.1, y, z + 0.82), 0.07, 0.16, gold, rot=(0, math.radians(-30), 0), group=group, tip=0.2, vertices=8)


def flower_pots(group):
    pot = mat("pot", (0.85, 0.5, 0.36), 0.7)
    colors = [(1.0, 0.5, 0.66), (1.0, 0.86, 0.36), (0.72, 0.6, 1.0)]
    for i, (x, y) in enumerate([(-3.5, 1.72), (-3.5, 2.02), (-3.55, 0.55)]):
        rcyl((x, y, 0.14), 0.12, 0.26, pot, group=group, vertices=16)
        sphere((x, y, 0.34), (0.15, 0.15, 0.11), mat(f"pot_flower{i}", colors[i], 0.5), group=group, seg=14)


def house(group):
    wall = mat("hut_wall", (1.0, 0.93, 0.8), 0.7)
    roof = mat("hut_roof", (0.95, 0.45, 0.45), 0.55)
    door = mat("hut_door", (0.62, 0.42, 0.3), 0.7)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    brick = mat("chimney", (0.78, 0.48, 0.4), 0.7)
    x, y = -4.3, 1.4
    rcube((x, y, 0.85), (0.7, 0.6, 0.85), wall, group=group, round_width=0.08)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.12, radius2=0, depth=0.8, location=(x, y, 2.1), rotation=(0, 0, math.radians(45)))
    r = bpy.context.active_object
    bev = r.modifiers.new("round", "BEVEL")
    bev.width = 0.08
    bev.segments = 4
    link(finish(r, roof, smooth=False), None, group)
    rcube((x - 0.3, y + 0.3, 2.2), (0.12, 0.12, 0.3), brick, group=group, round_width=0.03)
    rcube((x + 0.71, y - 0.18, 0.36), (0.02, 0.18, 0.3), door, group=group, round_width=0.02)
    for wy, wz in ((y + 0.3, 0.6), (y - 0.25, 1.3), (y + 0.3, 1.3)):
        rcube((x + 0.71, wy, wz), (0.02, 0.12, 0.12), window, group=group, round_width=0.02)


def stone_path(group):
    stone = mat("path_stone", (0.86, 0.82, 0.76), 0.85)
    for k in range(6):
        t = k / 5
        x = -3.3 + (-1.6 + 3.3) * t
        y = 1.15 + (0.05 - 1.15) * t
        rcyl((x + (0.12 if k % 2 else -0.1), y, 0.07), 0.2, 0.06, stone, group=group, vertices=16, round_ratio=0.4)


def roof_birds(group):
    blue = mat("bird_blue", (0.45, 0.68, 0.98), 0.5)
    yellow = mat("bird_beak", (1.0, 0.75, 0.3), 0.4)
    for k, x in enumerate((-0.6, 0.1, 0.8)):
        z = 2.36
        sphere((x, 3.5, z + 0.1), (0.11, 0.09, 0.09), blue, group=group, seg=14)
        sphere((x + 0.08, 3.5 - 0.02, z + 0.2), (0.07, 0.07, 0.07), blue, group=group, seg=12)
        rcone((x + 0.15, 3.48, z + 0.2), 0.025, 0.06, yellow, rot=(0, math.radians(90), 0), group=group, tip=0.1, vertices=8)


def more_apples(group):
    red = mat("apple", (0.95, 0.35, 0.38), 0.35)
    for dx, dy, dz in ((0.45, -0.35, 1.45), (-0.2, -0.45, 1.75), (0.1, -0.5, 1.25), (0.5, 0.0, 1.85), (-0.45, -0.1, 1.35)):
        sphere((4.6 + dx * 0.85, 1.6 + dy * 0.85, dz * 0.85 + 0.05), (0.08, 0.08, 0.08), red, group=group, seg=12)


def bunting(group):
    rope = mat("rope", (0.95, 0.5, 0.62), 0.6)
    colors = [(1.0, 0.5, 0.66), (1.0, 0.86, 0.36), (0.55, 0.78, 1.0), (0.72, 0.6, 1.0)]
    a = Vector((1.3, 2.75, 1.55))
    b = Vector((4.25, 1.55, 1.55))
    count = 9
    for k in range(count + 1):
        t = k / count
        p = a.lerp(b, t)
        p.z -= math.sin(math.pi * t) * 0.35
        sphere(tuple(p), (0.025, 0.025, 0.025), rope, group=group, seg=6)
        if 0 < k < count:
            rcone((p.x, p.y, p.z - 0.12), 0.09, 0.2, mat(f"flag{k % 4}", colors[k % 4], 0.5), rot=(math.radians(180), 0, 0), group=group, tip=0.05, vertices=3)


def silo(group):
    wall = mat("silo_wall", (0.95, 0.92, 0.86), 0.6)
    roof = mat("silo_roof", (0.62, 0.66, 0.72), 0.4)
    band = mat("barn_wall", (0.92, 0.4, 0.38), 0.65)
    x, y = 1.75, 3.65
    rcyl((x, y, 1.1), 0.42, 2.2, wall, group=group, vertices=32, round_ratio=0.15)
    for z in (0.6, 1.4):
        rcyl((x, y, z), 0.43, 0.08, band, group=group, vertices=32, round_ratio=0.3)
    sphere((x, y, 2.2), (0.43, 0.43, 0.32), roof, group=group, seg=24)


def cherry_tree(group):
    trunk = mat("trunk", (0.6, 0.42, 0.3), 0.75, noise=((0.52, 0.36, 0.26), 12))
    blossom = mat("blossom", (1.0, 0.76, 0.86), 0.7, sheen=0.3, noise=((0.98, 0.66, 0.8), 4))
    x, y = -2.6, 3.3
    rcyl((x, y, 0.6), 0.2, 1.2, trunk, group=group)
    for dx, dy, dz, r in [(0, 0, 1.65, 0.78), (0.38, 0.2, 1.4, 0.56), (-0.36, -0.15, 1.45, 0.56), (0.05, -0.3, 2.05, 0.52), (-0.1, 0.32, 1.95, 0.52)]:
        sphere((x + dx, y + dy, dz), (r, r, r * 0.9), blossom, group=group, seg=24)
    petal = mat("petal", (1.0, 0.82, 0.9), 0.6)
    for k, (px, py) in enumerate([(-1.9, 2.6), (-2.2, 2.2), (-3.1, 2.5), (-1.6, 3.0)]):
        sphere((px, py, 0.07), (0.06, 0.06, 0.02), petal, group=group, seg=8)


def fountain(group):
    stone = mat("pond_edge", (0.86, 0.82, 0.76), 0.8)
    spray = mat("spray", (0.75, 0.9, 1.0), 0.1)
    cx, cy = 1.9, -2.7
    rcyl((cx, cy, 0.3), 0.12, 0.5, stone, group=group, vertices=16)
    rcyl((cx, cy, 0.58), 0.38, 0.1, stone, group=group, vertices=24, round_ratio=0.4)
    rcone((cx, cy, 0.85), 0.12, 0.5, spray, group=group, tip=0.1, vertices=12)
    for k in range(6):
        a = 2 * math.pi * k / 6
        sphere((cx + 0.32 * math.cos(a), cy + 0.32 * math.sin(a), 0.72), (0.05, 0.05, 0.07), spray, group=group, seg=8)


def balloons(group):
    string = mat("string", (0.95, 0.95, 0.95), 0.6)
    colors = [(1.0, 0.45, 0.66), (0.5, 0.75, 1.0), (1.0, 0.86, 0.36)]
    for k, x in enumerate((-3.6, -1.1, 1.4)):
        top = 1.7 + (k % 2) * 0.2
        rcyl((x, -2.85, (0.8 + top) / 2), 0.008, top - 0.8, string, group=group, vertices=6, round_ratio=0.1)
        sphere((x, -2.85, top + 0.2), (0.2, 0.2, 0.25), mat(f"balloon{k}", colors[k], 0.25), group=group, seg=20)


def lantern_string(group):
    rope = mat("lamp_pole", (0.25, 0.32, 0.3), 0.45)
    colors = [(1.0, 0.75, 0.5), (1.0, 0.6, 0.72), (1.0, 0.9, 0.6)]
    a = Vector((-3.75, 1.9, 1.55))
    b = Vector((-2.2, 3.0, 1.8))
    count = 7
    for k in range(count + 1):
        t = k / count
        p = a.lerp(b, t)
        p.z -= math.sin(math.pi * t) * 0.25
        sphere(tuple(p), (0.02, 0.02, 0.02), rope, group=group, seg=6)
        if 0 < k < count:
            sphere((p.x, p.y, p.z - 0.09), (0.06, 0.06, 0.07), mat(f"lantern{k % 3}", colors[k % 3], 0.3, emission=GLOW + 1.2), group=group, seg=10)


def stripe_faces(obj, center, material_b, panels=8):
    """気球の布を縦に塗り分ける。面の中心が、真上から見てどの角度にあるかで、2つ目の色にする。"""
    obj.data.materials.append(material_b)
    cx, cy = center
    for poly in obj.data.polygons:
        x, y = poly.center.x - cx, poly.center.y - cy
        angle = (math.atan2(y, x) + math.pi) / (2 * math.pi)
        poly.material_index = int(angle * panels) % 2


def hot_air_balloon(group):
    basket = mat("basket", (0.72, 0.5, 0.32), 0.7)
    x, y, z = 2.0, 4.5, 3.6
    pink = mat("balloon_pink", (1.0, 0.5, 0.66), 0.45)
    cream = mat("balloon_cream", (1.0, 0.94, 0.7), 0.45)
    envelope = sphere((x, y, z), (0.72, 0.72, 0.82), pink, group=group, seg=32)
    stripe_faces(envelope, (x, y), cream)
    skirt = rcone((x, y, z - 0.78), 0.34, 0.3, pink, rot=(math.radians(180), 0, 0), group=group, tip=0.55, vertices=24)
    stripe_faces(skirt, (x, y), cream)
    rcube((x, y, z - 1.15), (0.22, 0.22, 0.16), basket, group=group, round_width=0.05)
    for dx, dy in ((-0.16, -0.16), (0.16, -0.16), (-0.16, 0.16), (0.16, 0.16)):
        rcyl((x + dx, y + dy, z - 0.8), 0.01, 0.6, mat("string", (0.95, 0.95, 0.95), 0.6), group=group, vertices=6, round_ratio=0.1)


def rainbow(group):
    colors = [(1.0, 0.45, 0.5), (1.0, 0.7, 0.4), (1.0, 0.92, 0.45), (0.5, 0.85, 0.5), (0.5, 0.72, 1.0), (0.75, 0.6, 1.0)]
    holder = empty((-7.0, 3.6, -1.9), group=group)
    holder.rotation_euler = (-CAMERA_DIR).to_track_quat("Z", "Y").to_euler()
    for k, color in enumerate(colors):
        bpy.ops.mesh.primitive_torus_add(major_radius=2.3 - k * 0.12, minor_radius=0.065, major_segments=64, minor_segments=8)
        band = bpy.context.active_object
        mesh = band.data
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.02], context="VERTS")
        bm.to_mesh(mesh)
        bm.free()
        finish(band, mat(f"rainbow{k}", color, 0.5, emission=0.4))
        link(band, holder, group)


def butterflies(group):
    colors = [(1.0, 0.7, 0.85), (1.0, 0.95, 0.6), (0.75, 0.85, 1.0)]
    for k, (x, y, z) in enumerate([(3.4, -1.3, 1.0), (4.0, -1.8, 1.25), (3.2, -1.9, 1.4)]):
        wing = mat(f"wing{k}", colors[k], 0.4)
        for side in (-1, 1):
            sphere((x, y + side * 0.08, z), (0.04, 0.09, 0.07), wing, group=group, seg=10)
        sphere((x, y, z), (0.02, 0.02, 0.05), mat("eye", (0.04, 0.03, 0.04), 0.15), group=group, seg=6)


def windmill_garland(group):
    colors = [(1.0, 0.5, 0.66), (1.0, 0.86, 0.36), (0.72, 0.6, 1.0), (1.0, 1.0, 1.0)]
    x, y = 4.9, -0.4
    for k in range(14):
        a = 2 * math.pi * k / 14
        sphere((x + 0.47 * math.cos(a), y + 0.47 * math.sin(a), 1.25), (0.08, 0.08, 0.07), mat(f"bed_flower{k % 4}", colors[k % 4], 0.5), group=group, seg=10)
    sphere((x - 0.5, y - 0.5, 1.75), (0.05, 0.12, 0.11), mat("ribbon", (1.0, 0.45, 0.66), 0.45), group=group, seg=12)


def gold_fence(group):
    white = mat("white_wood", (0.98, 0.96, 0.92), 0.6)
    gold = mat("crown_gold", (1.0, 0.8, 0.32), 0.18)
    for i in range(5):
        x = -3.6 + i * 1.25
        rcyl((x, -2.85, 0.42), 0.11, 0.8, white, group=group)
        sphere((x, -2.85, 0.88), (0.12, 0.12, 0.12), gold, group=group, seg=14)
    for z in (0.36, 0.66):
        rcube((-1.1, -2.85, z), (2.6, 0.06, 0.06), white, group=group, round_width=0.05)


def castle_tower(group):
    wall = mat("castle_wall", (1.0, 0.95, 0.9), 0.6)
    roof = mat("castle_roof", (1.0, 0.55, 0.72), 0.45)
    gold = mat("crown_gold", (1.0, 0.8, 0.32), 0.18)
    window = mat("window", (1.0, 0.85, 0.5), 0.3, emission=WINDOW_GLOW)
    x, y = -5.0, -0.1
    rcyl((x, y, 1.05), 0.55, 2.1, wall, group=group, vertices=32, round_ratio=0.12)
    rcyl((x, y, 2.12), 0.62, 0.14, gold, group=group, vertices=32, round_ratio=0.3)
    rcone((x, y, 2.62), 0.66, 0.9, roof, group=group, tip=0.02, vertices=32)
    rcyl((x, y, 3.15), 0.015, 0.2, gold, group=group, vertices=6, round_ratio=0.1)
    rcube((x + 0.05, y + 0.1, 3.18), (0.01, 0.1, 0.05), roof, group=group, round_width=0.01)
    for wz in (0.9, 1.6):
        rcube((x + 0.52, y, wz), (0.03, 0.1, 0.16), window, group=group, round_width=0.03)


# レベルごとの施設（index = レベル - 1）。None は芝の島だけ。
FACILITIES = [
    None, fence, trough, hut, flower_bed, windmill, pond, barn, clock_tower, golden_statue,
    mailbox, street_lamps, weathervane, flower_pots, house, stone_path, roof_birds, more_apples, bunting, silo,
    cherry_tree, fountain, balloons, lantern_string, hot_air_balloon, rainbow, butterflies, windmill_garland, gold_fence, castle_tower,
]
# 置き換え: 後のレベルの施設が出たら、前の施設を隠す（index → 置き換える側の index）。
# 小屋 → 二階建ての家（Lv15）、柵 → 金の柵（Lv29）、時計台 → お城の塔（Lv30）。左の木 → 桜（Lv21）は LEFT_TREE で扱う。
REPLACED_BY = {3: 14, 1: 28, 8: 29}
LEFT_TREE_REPLACED_AT = 20


# ───────────── 立ち位置（地面の上、管理人の画面で動物が歩く場所） ─────────────
SPOTS = [
    (-0.7, 1), (-2.5, -1), (0.9, 2), (0.4, -2), (-0.5, 2.4), (1.9, -1.2),
    (-2.2, 0.5), (1.6, 1), (-0.9, -1.3), (3, 0.3), (0.5, -0.2), (2.6, -0.5),
]
# 柵の外を見る位置・杭の位置・干し草の位置（動物の右前に置く）
FENCE_SPOT = (-1.3, -2.25)
STAKE_SPOT = (-3.3, 0.6)


def set_visible(objects, visible):
    for obj in objects:
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def camera(name, target, ortho, res_x, res_y):
    bpy.ops.object.camera_add(location=target - CAMERA_DIR * 20)
    cam = bpy.context.active_object
    cam.name = name
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    cam.data.clip_end = 100
    cam.rotation_euler = CAMERA_DIR.to_track_quat("-Z", "Y").to_euler()
    return cam


def lighting():
    light_dir = {"day": Vector((-1.0, 0.35, 1.15)), "evening": Vector((-1.3, 0.9, 0.55)), "night": Vector((-0.6, 1.0, 1.2))}[TIME]
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 10))
    sun = bpy.context.active_object
    sun.data.energy = {"day": 3.2, "evening": 2.6, "night": 1.1}[TIME]
    sun.data.color = {"day": (1.0, 0.94, 0.82), "evening": (1.0, 0.68, 0.48), "night": (0.6, 0.7, 1.0)}[TIME]
    sun.data.angle = math.radians(22)
    sun.rotation_euler = (-light_dir).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = {"day": (0.85, 0.9, 1.0, 1), "evening": (0.95, 0.72, 0.72, 1), "night": (0.2, 0.25, 0.5, 1)}[TIME]
    bg.inputs["Strength"].default_value = {"day": 0.62, "evening": 0.5, "night": 0.4}[TIME]


def render(path, cam, res_x, res_y):
    scene.camera = cam
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("WROTE", path)


def screen_point(cam, res_x, res_y, world):
    co = world_to_camera_view(scene, cam, Vector(world))
    return round(co.x, 4), round(1 - co.y, 4)


lighting()
scene.render.film_transparent = True
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.quality = 82
scene.view_settings.view_transform = "Standard"
try:
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_raytracing = True
except AttributeError:
    pass

base = []
island(base)
base_tree = []
left_tree(base_tree)
levels = [[] for _ in FACILITIES]
for index, build in enumerate(FACILITIES):
    if build:
        build(levels[index])

scene_cam = camera("scene", Vector((0, 0, 1.15)), SCENE_ORTHO, SCENE_W, SCENE_H)
scene.render.resolution_x = SCENE_W
scene.render.resolution_y = SCENE_H
sprite_cam = camera("sprite", Vector((0, 0, 0.75)), SPRITE_ORTHO, SPRITE_PX, SPRITE_PX)

bpy.context.view_layer.update()

if LAYOUT_ONLY:
    scene.render.resolution_x = SCENE_W
    scene.render.resolution_y = SCENE_H
    layout = {
        "scene": {"width": SCENE_W, "height": SCENE_H, "ortho": SCENE_ORTHO},
        "sprite": {"size": SPRITE_PX, "ortho": SPRITE_ORTHO},
        "spots": [screen_point(scene_cam, SCENE_W, SCENE_H, (x, y, 0.06)) for x, y in SPOTS],
        "fence": screen_point(scene_cam, SCENE_W, SCENE_H, (*FENCE_SPOT, 0.06)),
        "stake": screen_point(scene_cam, SCENE_W, SCENE_H, (*STAKE_SPOT, 0.06)),
    }
    scene.render.resolution_x = SPRITE_PX
    scene.render.resolution_y = SPRITE_PX
    layout["sprite"]["foot"] = screen_point(sprite_cam, SPRITE_PX, SPRITE_PX, (0, 0, 0))
    print("LAYOUT " + json.dumps(layout))
    sys.exit(0)

# 背景: レベルごとに、そこまでの施設を出す（置き換えられた施設は隠す）。
everything = [obj for group in levels for obj in group]
for level in range(1, len(FACILITIES) + 1):
    if ONLY_LEVELS and level not in ONLY_LEVELS:
        continue
    set_visible(base, True)
    set_visible(base_tree, LEFT_TREE_REPLACED_AT >= level)
    for index, group in enumerate(levels):
        replaced = index in REPLACED_BY and REPLACED_BY[index] < level
        set_visible(group, index < level and not replaced)
    render(f"{OUT}/ranch-lv{level}-{TIME}.webp", scene_cam, SCENE_W, SCENE_H)

set_visible(base, False)
set_visible(base_tree, False)
set_visible(everything, False)

# 動物と小物: 原点に1つずつ置いて描く。顔は画面の左下（見る人の方）へ向ける。
# なつき0は名前に段階を付けない（前からの名前のまま）。1〜4は -t1〜-t4。
for kind, build in ANIMALS.items():
    for pose in POSES:
        if ONLY_SPRITES and kind not in ONLY_SPRITES and f"{kind}-{pose}" not in ONLY_SPRITES:
            continue
        for tier in FONDNESS_TIERS:
            group = []
            root = build(pose, group, tier)
            root.rotation_euler[2] = math.radians(-30)
            suffix = f"-t{tier}" if tier else ""
            render(f"{OUT}/{kind}-{pose}{suffix}-{TIME}.webp", sprite_cam, SPRITE_PX, SPRITE_PX)
            set_visible(group, False)

for name, build in PROPS.items():
    if ONLY_SPRITES and f"prop-{name}" not in ONLY_SPRITES:
        continue
    group = []
    build(group)
    render(f"{OUT}/prop-{name}-{TIME}.webp", sprite_cam, SPRITE_PX, SPRITE_PX)
    set_visible(group, False)
