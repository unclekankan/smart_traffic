"""
智慧交通后端服务（FastAPI）

当前提供成都地铁线路 / 站点的 GeoJSON 接口，供前端地图渲染与详情展示。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import metro, bus

app = FastAPI(title="智慧交通后端", version="0.1.0")

# 前端开发服务器与后端端口不同，需放开跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(metro.router)
app.include_router(bus.router)


@app.get("/", tags=["health"])
def root():
    return {"message": "智慧交通后端服务运行中", "docs": "/docs"}
