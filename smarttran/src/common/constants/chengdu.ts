/**
 * 成都市行政区划（主城 5 区 + 近郊 + 县市，共 20 个区县）
 *
 * 坐标取各区县政府驻地附近，供天气服务逐区查询。
 */

import type { LngLat } from '../types/geo'

export interface DistrictMeta {
  name: string
  center: LngLat
}

export const CHENGDU_CITY: DistrictMeta = { name: '成都市', center: [104.0665, 30.5723] }

export const CHENGDU_DISTRICTS: readonly DistrictMeta[] = [
  { name: '锦江区', center: [104.0809, 30.6576] },
  { name: '青羊区', center: [104.0625, 30.6739] },
  { name: '金牛区', center: [104.0435, 30.6921] },
  { name: '武侯区', center: [104.0517, 30.6418] },
  { name: '成华区', center: [104.1013, 30.6599] },
  { name: '龙泉驿区', center: [104.2746, 30.5565] },
  { name: '青白江区', center: [104.2509, 30.8786] },
  { name: '新都区', center: [104.1587, 30.8238] },
  { name: '温江区', center: [103.8566, 30.6823] },
  { name: '双流区', center: [103.9236, 30.5744] },
  { name: '郫都区', center: [103.9026, 30.7958] },
  { name: '新津区', center: [103.8114, 30.4102] },
  { name: '都江堰市', center: [103.6185, 30.9979] },
  { name: '彭州市', center: [103.958, 30.99] },
  { name: '邛崃市', center: [103.4641, 30.4103] },
  { name: '崇州市', center: [103.673, 30.6301] },
  { name: '简阳市', center: [104.5469, 30.4113] },
  { name: '金堂县', center: [104.4319, 30.8619] },
  { name: '大邑县', center: [103.5118, 30.5866] },
  { name: '蒲江县', center: [103.5065, 30.1968] },
]
