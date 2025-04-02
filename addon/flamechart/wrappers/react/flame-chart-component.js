import {FlameChart} from "../../index.js";

let h = React.createElement;

export class FlameChartComponent extends React.Component {
  constructor(props) {
    super(props);
    const {data, settings, colors, plugins} = props;
    if (this.canvasRef && this.boxRef) {
      const {width = 0, height = 0} = this.boxRef.getBoundingClientRect();
      this.canvasRef.width = width;
      this.canvasRef.height = height - 3;
      this.flameChart = new FlameChart({
        canvas: this.canvasRef,
        data,
        settings,
        colors,
        plugins,
      });
      this.props.instance?.call(this, this.flameChart);
    }
  }
  componentDidMount() {
    this.boxRef = this.refs.boxRef;
    this.canvasRef = this.refs.canvasRef;
    const {data, settings, colors, plugins} = this.props;
    if (this.canvasRef && this.boxRef) {
      const {width = 0, height = 0} = this.boxRef.getBoundingClientRect();
      this.canvasRef.width = width;
      this.canvasRef.height = height - 3;
      this.flameChart = new FlameChart({
        canvas: this.canvasRef,
        data,
        settings,
        colors,
        plugins,
      });
      if (this.props.instance) {
        this.props.instance.call(this.props, this.flameChart);
      }
    }
    let self = this;
    function resize() {
      if (self.flameChart) {
        self.flameChart.resize(innerWidth, innerHeight - 3);
        //model.didUpdate();
      }
    }
    addEventListener("resize", resize);
    resize();
    if (this.flameChart) {
      if (this.props.data) {
        this.flameChart.setNodes(this.props.data);
      }
      if (this.props.settings && this.flameChart) {
        this.flameChart.setSettings(this.props.settings);
        this.flameChart.renderEngine.recalcChildrenLayout();
        this.flameChart.render();
      }
      if (this.props.position) {
        this.flameChart.setFlameChartPosition(this.props.position);
      }
      if (this.props.zoom) {
        this.flameChart.setZoom(this.props.zoom.start, this.props.zoom.end);
      }
      if (typeof this.props.hotkeys === "boolean") {
        this.flameChart.hotkeys(this.props.hotkeys);
      }
      if (this.props.onSelect) {
        this.flameChart.on("select", this.props.onSelect);
      }
    }
  }
  componentWillUnmount() {
    if (this.props.onSelect) {
      this.flameChart.removeListener("select", this.props.onSelect);
    }
  }
  render() {
    return h("div", {className: this.props.className, ref: "boxRef"},
      h("canvas", {ref: "canvasRef"})
    );
  }
}
