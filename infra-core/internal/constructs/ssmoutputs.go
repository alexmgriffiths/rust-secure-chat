package constructs

import (
	"strings"

	"github.com/aws/aws-cdk-go/awscdk/v2/awsssm"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

type StringParamProps struct {
	Name  string
	Value string
}

func PutStringParam(scope constructs.Construct, id string, props StringParamProps) awsssm.StringParameter {
	return awsssm.NewStringParameter(scope, jsii.String(id), &awsssm.StringParameterProps{
		ParameterName: jsii.String(props.Name),
		StringValue:   jsii.String(props.Value),
	})
}

func PutStringListParam(scope constructs.Construct, id string, name string, values []string) awsssm.StringParameter {
	joined := strings.Join(values, ",")
	return PutStringParam(scope, id, StringParamProps{Name: name, Value: joined})
}
